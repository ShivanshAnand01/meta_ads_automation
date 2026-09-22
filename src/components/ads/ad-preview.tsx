'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'
import { aspectCss, CTAS } from '@/lib/ai/profile-constants'
import { Globe, ImageOff, MoreHorizontal, ThumbsUp, MessageCircle, Share2 } from 'lucide-react'

/**
 * A Meta feed-style ad preview.
 *
 * The client approves creatives by looking at them, so they should see the
 * creative the way a customer will: page name on top, primary text, the image
 * at its real aspect ratio, then headline and CTA in the link card. The old
 * page showed a 48px thumbnail in a table row — impossible to judge.
 *
 * Meta's visible-text limits are drawn as real truncation, so if the copy is
 * too long the owner sees exactly where it gets cut.
 */

export interface AdPreviewData {
  pageName?: string | null
  primaryText?: string | null
  headline?: string | null
  description?: string | null
  callToAction?: string | null
  imageUrl?: string | null
  aspectRatio?: string | null
  linkHost?: string | null
  language?: string | null
}

const PRIMARY_TEXT_LIMIT = 125
const HEADLINE_LIMIT = 40

/** Script-aware font: Devanagari and friends need their own face to render cleanly. */
function langClass(language: string | null | undefined): string {
  if (!language) return ''
  const l = language.toLowerCase()
  if (l === 'mr' || l === 'hi' || l === 'marathi' || l === 'hindi') return 'marathi'
  return ''
}

export function AdPreview({ ad, className, compact = false }: { ad: AdPreviewData; className?: string; compact?: boolean }) {
  const cta = CTAS.find((c) => c.value === ad.callToAction)?.label ?? (ad.callToAction || 'Learn more').replace(/_/g, ' ').toLowerCase()
  const primary = ad.primaryText || ''
  const primaryOver = [...primary].length > PRIMARY_TEXT_LIMIT
  const shownPrimary = primaryOver ? [...primary].slice(0, PRIMARY_TEXT_LIMIT).join('') : primary
  const headline = ad.headline || ''
  const headlineOver = [...headline].length > HEADLINE_LIMIT
  const font = langClass(ad.language)

  return (
    <article
      className={cn('overflow-hidden rounded-xl border border-border bg-card text-card-foreground', className)}
      aria-label={`Ad preview: ${ad.headline || ad.primaryText || 'untitled'}`}
    >
      {/* Page header row */}
      <header className={cn('flex items-center gap-2.5 px-3', compact ? 'py-2' : 'py-2.5')}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {(ad.pageName || 'A').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold">{ad.pageName || 'Your Page'}</p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Sponsored · <Globe aria-hidden="true" className="h-3 w-3" />
          </p>
        </div>
        <MoreHorizontal aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
      </header>

      {/* Primary text */}
      {primary && (
        <p className={cn('px-3 pb-2 text-[13px] leading-snug whitespace-pre-line', font)} lang={ad.language || undefined}>
          {shownPrimary}
          {primaryOver && (
            <span className="text-muted-foreground"> …<span className="ml-1 text-[11px]">See more</span></span>
          )}
        </p>
      )}

      {/* Media at the real ratio. Reserving the box prevents layout shift. */}
      <div className="relative w-full bg-muted" style={{ aspectRatio: aspectCss(ad.aspectRatio) }}>
        {ad.imageUrl ? (
          <Image
            src={ad.imageUrl}
            alt={ad.headline || ad.primaryText || 'Ad image'}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="object-cover"
            unoptimized={ad.imageUrl.includes('/object/sign/')}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff aria-hidden="true" className="h-6 w-6" />
            <span className="text-xs">No image yet</span>
          </div>
        )}
      </div>

      {/* Link card */}
      <div className="flex items-center gap-3 border-t border-border bg-muted/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{ad.linkHost || 'yourwebsite.com'}</p>
          <p className={cn('truncate text-[14px] font-semibold leading-tight', font, headlineOver && 'text-[var(--status-critical-ink)]')} lang={ad.language || undefined} title={headlineOver ? `Headline is ${[...headline].length} characters; Meta shows about ${HEADLINE_LIMIT}.` : undefined}>
            {headline || <span className="font-normal text-muted-foreground">No headline</span>}
          </p>
          {ad.description && <p className="truncate text-[12px] text-muted-foreground">{ad.description}</p>}
        </div>
        <span className="shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-semibold capitalize">
          {cta}
        </span>
      </div>

      {/* Reaction row: decoration that makes it read as a feed post. */}
      {!compact && (
        <div aria-hidden="true" className="flex items-center justify-around border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" />Like</span>
          <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />Comment</span>
          <span className="inline-flex items-center gap-1"><Share2 className="h-3.5 w-3.5" />Share</span>
        </div>
      )}
    </article>
  )
}

/** Small inline warnings about Meta's visible-text limits. */
export function copyLimitNotes(ad: AdPreviewData): string[] {
  const notes: string[] = []
  const p = [...(ad.primaryText || '')].length
  const h = [...(ad.headline || '')].length
  if (p > PRIMARY_TEXT_LIMIT) notes.push(`Primary text is ${p} characters; Meta truncates around ${PRIMARY_TEXT_LIMIT}.`)
  if (h > HEADLINE_LIMIT) notes.push(`Headline is ${h} characters; Meta shows about ${HEADLINE_LIMIT}.`)
  if (!ad.imageUrl) notes.push('No image — this cannot be published as an image ad.')
  return notes
}
