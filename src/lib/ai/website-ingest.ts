import { ingestDocument } from '@/lib/ai/rag'
import { getScopedSupabase } from '@/lib/db/supabase-db'
import type { AIProviderType } from '@/lib/ai/types'

/**
 * Website → knowledge base.
 *
 * The agent cannot write accurate ads for a business it knows nothing about.
 * This crawls the user's site — the home page plus the handful of pages that
 * actually describe the business (about, products, services, pricing,
 * contact) — extracts the readable text, and feeds it into the same pgvector
 * RAG store that pasted documents use. It also returns what it learned about
 * the site so onboarding can pre-fill the business profile instead of asking
 * for things the website already says.
 */

const MAX_PAGES = 6
const MAX_BYTES_PER_PAGE = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 12_000
const MIN_USEFUL_CHARS = 200

/** Path keywords that tend to describe the business rather than list blog posts. */
const INTERESTING_PATHS = /\/(about|about-us|who-we-are|our-story|products?|services?|pricing|plans|shop|store|menu|catalog|contact|faq)\b/i

const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|::1)/i

export interface CrawledPage {
  url: string
  title: string
  text: string
  chars: number
}

export interface WebsiteIngestResult {
  success: boolean
  pagesIngested: number
  pages: Array<{ url: string; title: string; chars: number; documentId: string | null }>
  /** Facts learned from the site that onboarding can pre-fill. */
  learned: {
    siteTitle: string | null
    description: string | null
    htmlLang: string | null
    detectedLanguageHint: string | null
    phoneOrWhatsApp: string | null
    socialLinks: string[]
  }
  warnings: string[]
}

/** A private/loopback destination is not a website, it is an SSRF attempt. */
function assertPublicHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    throw new Error(`"${raw}" is not a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs can be crawled')
  if (BLOCKED_HOSTS.test(url.hostname)) throw new Error('That address is not a public website')
  return url
}

async function fetchPage(url: URL): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; AdManagerBot/1.0; +knowledge-base crawler)', accept: 'text/html' },
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') || ''
    if (!type.includes('text/html')) return null
    const length = Number(res.headers.get('content-length') || 0)
    if (length > MAX_BYTES_PER_PAGE) return null
    const html = await res.text()
    return html.length > MAX_BYTES_PER_PAGE ? html.slice(0, MAX_BYTES_PER_PAGE) : html
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── HTML → text, without a dependency ─────────────────────────────────────
// Good enough for marketing sites, which is what we are reading. If a client
// site is a JS-rendered SPA with nothing in the HTML, the crawl reports
// "too little text" and the agent falls back to asking.

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i')
  const m = html.match(re) || html.match(alt)
  return m ? decodeEntities(m[1]).trim() : null
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim())

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Navigation and footers repeat on every page and drown the real content.
    .replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')

  // Keep alt text — product images often carry the product name.
  body = body.replace(/<img[^>]+alt=["']([^"']+)["'][^>]*>/gi, ' $1 ')
  // Block-level tags become line breaks so headings and paragraphs separate.
  body = body.replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
  body = body.replace(/<[^>]+>/g, ' ')
  body = decodeEntities(body)
  body = body
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1)
    .join('\n')

  return { title, text: body }
}

function sameOriginLinks(html: string, base: URL): string[] {
  const out = new Set<string>()
  const re = /href=["']([^"'#?]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base)
      if (u.origin !== base.origin) continue
      if (!INTERESTING_PATHS.test(u.pathname)) continue
      if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|css|js)$/i.test(u.pathname)) continue
      u.hash = ''
      u.search = ''
      out.add(u.toString())
    } catch {
      /* ignore malformed hrefs */
    }
  }
  return [...out]
}

function findContact(text: string): string | null {
  const wa = text.match(/wa\.me\/(\d{8,15})/) || text.match(/whatsapp[^\d]{0,20}(\+?\d[\d\s-]{8,14}\d)/i)
  if (wa) return wa[1].replace(/\s|-/g, '')
  const phone = text.match(/(\+91[\s-]?\d{5}[\s-]?\d{5}|\b\d{10}\b)/)
  return phone ? phone[1].replace(/\s|-/g, '') : null
}

function findSocial(html: string): string[] {
  const links = new Set<string>()
  const re = /https?:\/\/(?:www\.)?(facebook|instagram|youtube|linkedin|twitter|x)\.com\/[A-Za-z0-9_.\-/]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) links.add(m[0])
  return [...links].slice(0, 6)
}

/**
 * Rough script detection from the visible text, so onboarding can suggest a
 * language instead of assuming English. The profile is still the source of
 * truth — this is only a hint.
 */
function detectLanguageHint(text: string, htmlLang: string | null): string | null {
  if (htmlLang && htmlLang.length >= 2) return htmlLang.slice(0, 2).toLowerCase()
  const sample = text.slice(0, 4000)
  const counts: Array<[string, RegExp]> = [
    ['mr/hi', /[ऀ-ॿ]/g],   // Devanagari — Marathi or Hindi, agent asks which
    ['gu', /[઀-૿]/g],
    ['ta', /[஀-௿]/g],
    ['te', /[ఀ-౿]/g],
    ['kn', /[ಀ-೿]/g],
    ['ml', /[ഀ-ൿ]/g],
    ['bn', /[ঀ-৿]/g],
    ['pa', /[਀-੿]/g],
    ['ar/ur', /[؀-ۿ]/g],
  ]
  let best: [string, number] = ['en', 0]
  for (const [code, re] of counts) {
    const n = (sample.match(re) || []).length
    if (n > best[1]) best = [code, n]
  }
  return best[1] > 40 ? best[0] : 'en'
}

// ── The crawl ─────────────────────────────────────────────────────────────

export async function crawlWebsite(rawUrl: string): Promise<{ pages: CrawledPage[]; learned: WebsiteIngestResult['learned']; warnings: string[] }> {
  const root = assertPublicHttpUrl(rawUrl)
  const warnings: string[] = []

  const homeHtml = await fetchPage(root)
  if (!homeHtml) throw new Error(`Could not fetch ${root.hostname}. Is the site online and public?`)

  const home = htmlToText(homeHtml)
  const learned: WebsiteIngestResult['learned'] = {
    siteTitle: home.title || null,
    description: extractMeta(homeHtml, 'description') || extractMeta(homeHtml, 'og:description'),
    htmlLang: homeHtml.match(/<html[^>]+lang=["']([a-zA-Z-]+)["']/i)?.[1] ?? null,
    detectedLanguageHint: null,
    phoneOrWhatsApp: findContact(homeHtml + '\n' + home.text),
    socialLinks: findSocial(homeHtml),
  }
  learned.detectedLanguageHint = detectLanguageHint(home.text, learned.htmlLang)

  const pages: CrawledPage[] = []
  if (home.text.length >= MIN_USEFUL_CHARS) {
    pages.push({ url: root.toString(), title: home.title || root.hostname, text: home.text, chars: home.text.length })
  } else {
    warnings.push('The home page has very little readable text — it may be rendered by JavaScript. The agent will ask more questions instead.')
  }

  const candidates = sameOriginLinks(homeHtml, root).slice(0, MAX_PAGES - 1)
  const fetched = await Promise.all(
    candidates.map(async (href) => {
      const html = await fetchPage(new URL(href))
      if (!html) return null
      const { title, text } = htmlToText(html)
      if (text.length < MIN_USEFUL_CHARS) return null
      return { url: href, title: title || href, text, chars: text.length } satisfies CrawledPage
    }),
  )
  for (const page of fetched) if (page) pages.push(page)

  return { pages, learned, warnings }
}

/**
 * Crawl and ingest. Re-running on the same site replaces the previous copy
 * of each page rather than stacking duplicates in the vector store.
 */
export async function ingestWebsite(params: {
  userId: string
  url: string
  provider: AIProviderType
  apiKey?: string | null
  baseUrl?: string | null
  embeddingKey?: string | null
}): Promise<WebsiteIngestResult> {
  const { userId, url, provider, apiKey, baseUrl, embeddingKey } = params
  const { pages, learned, warnings } = await crawlWebsite(url)

  const supabase = await getScopedSupabase()
  const results: WebsiteIngestResult['pages'] = []

  for (const page of pages) {
    // Replace, don't duplicate.
    await supabase.from('knowledge_documents').delete().eq('user_id', userId).eq('source_url', page.url)

    try {
      const ingested = await ingestDocument({
        userId,
        title: `Website: ${page.title}`,
        content: `Source: ${page.url}\n\n${page.text}`,
        sourceType: 'website',
        provider,
        apiKey,
        baseUrl,
        embeddingKey,
      })
      await supabase.from('knowledge_documents').update({ source_url: page.url }).eq('id', ingested.documentId)
      results.push({ url: page.url, title: page.title, chars: page.chars, documentId: ingested.documentId })
      if (!ingested.embedded) warnings.push(`"${page.title}" was stored but not embedded — add an OpenAI embedding key in Settings for semantic search.`)
    } catch (err) {
      warnings.push(`Failed to ingest ${page.url}: ${err instanceof Error ? err.message : 'unknown error'}`)
      results.push({ url: page.url, title: page.title, chars: page.chars, documentId: null })
    }
  }

  return {
    success: results.some((r) => r.documentId),
    pagesIngested: results.filter((r) => r.documentId).length,
    pages: results,
    learned,
    warnings,
  }
}
