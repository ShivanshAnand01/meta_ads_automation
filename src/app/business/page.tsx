'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageHeader, Section, StatusPill } from '@/components/ui/metric'
import { TextField, TextAreaField, ChipGroup, TagInput, Field } from '@/components/ui/field'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LANGUAGES, OBJECTIVES, CTAS, type LanguageMode } from '@/lib/ai/profile-constants'
import { Globe, Loader2, Save, Sparkles, Check } from 'lucide-react'

/**
 * Business Profile.
 *
 * This is the page the whole product is written against. The agent reads
 * these fields before it writes any copy, so the owner should be able to see
 * exactly what the AI believes about their business and correct it directly,
 * without having to phrase it as a chat message.
 */

interface Profile {
  businessName: string | null
  websiteUrl: string | null
  industry: string | null
  description: string | null
  products: string | null
  usp: string | null
  primaryLanguage: string
  secondaryLanguages: string[]
  languageMode: LanguageMode
  marketCountry: string
  marketRegions: string[]
  marketCities: string[]
  currency: string
  targetAudience: string | null
  tone: string | null
  brandColors: string[]
  avoid: string | null
  defaultObjective: string | null
  defaultCta: string | null
  landingUrl: string | null
  culturalNotes: string | null
  onboardingComplete: boolean
}

type Form = { [K in keyof Profile]: Profile[K] extends string | null ? string : Profile[K] }

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD']
const COUNTRIES = [
  { value: 'IN', label: 'India' }, { value: 'US', label: 'United States' }, { value: 'GB', label: 'United Kingdom' },
  { value: 'AE', label: 'UAE' }, { value: 'SG', label: 'Singapore' }, { value: 'AU', label: 'Australia' }, { value: 'CA', label: 'Canada' },
]
const TONES = ['Warm and respectful', 'Direct and confident', 'Playful', 'Premium and calm', 'Urgent, offer-led', 'Educational']

function toForm(p: Profile): Form {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) out[k] = v === null ? '' : v
  return out as Form
}

function isValidUrl(v: string): boolean {
  if (!v) return true
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}

export default function BusinessPage() {
  const [saved, setSaved] = useState<Profile | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/business-profile')
      .then((r) => r.json())
      .then((j) => { setSaved(j.profile); setForm(toForm(j.profile)); setMissing(j.missing || []) })
      .catch(() => toast.error('Could not load the business profile'))
      .finally(() => setLoading(false))
  }, [])

  const dirty = useMemo(() => saved && form && JSON.stringify(toForm(saved)) !== JSON.stringify(form), [saved, form])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  async function save() {
    if (!form) return
    const errs: Record<string, string> = {}
    if (!isValidUrl(form.websiteUrl)) errs.websiteUrl = 'Enter a full address starting with https://'
    if (!isValidUrl(form.landingUrl)) errs.landingUrl = 'Enter a full address starting with https://'
    setErrors(errs)
    if (Object.keys(errs).length) { toast.error('Fix the highlighted fields'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/business-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Save failed')
      setSaved(j.profile); setForm(toForm(j.profile)); setMissing(j.missing || [])
      toast.success('Profile saved. The AI will use it from the next message.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function learnFromWebsite() {
    if (!form?.websiteUrl || !isValidUrl(form.websiteUrl)) { setErrors({ websiteUrl: 'Enter the website address first.' }); return }
    setCrawling(true)
    try {
      const res = await fetch('/api/knowledge-base/website', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: form.websiteUrl }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not read the website')
      const filled: string[] = j.profilePrefilled || []
      toast.success(filled.length ? `Read the site and filled: ${filled.join(', ')}` : 'Website read into the knowledge base')
      const fresh = await fetch('/api/business-profile').then((r) => r.json())
      setSaved(fresh.profile); setForm(toForm(fresh.profile)); setMissing(fresh.missing || [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the website')
    } finally {
      setCrawling(false)
    }
  }

  if (loading || !form) return <PageSkeleton rows={4} />

  const known = 6 - missing.length
  const lang = LANGUAGES[form.primaryLanguage]

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Business Profile"
        description="What the AI knows about you. Every ad is written from this page."
        meta={
          missing.length === 0
            ? <StatusPill tone="good">Complete</StatusPill>
            : <StatusPill tone="warning">{known} of 6 essentials filled · still needs {missing.join(', ')}</StatusPill>
        }
      />

      <Section title="Business" description="Who you are and what you sell.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField label="Business name" required value={form.businessName} onChange={(v) => set('businessName', v)} placeholder="Marathi Dnyan" />
          <TextField label="Industry" value={form.industry} onChange={(v) => set('industry', v)} placeholder="Digital publishing, dentistry, restaurant…" />
          <div className="md:col-span-2">
            <TextField
              label="Website"
              type="url" inputMode="url"
              value={form.websiteUrl}
              onChange={(v) => set('websiteUrl', v)}
              error={errors.websiteUrl}
              placeholder="https://"
              hint="The AI reads it to learn your products, prices and voice."
              trailing={
                <Button size="sm" variant="outline" onClick={learnFromWebsite} disabled={crawling || !form.websiteUrl}>
                  {crawling ? <Loader2 aria-hidden="true" className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Globe aria-hidden="true" className="mr-1 h-3.5 w-3.5" />}
                  {crawling ? 'Reading…' : 'Learn from website'}
                </Button>
              }
            />
          </div>
          <TextAreaField label="What does the business do?" rows={3} value={form.description} onChange={(v) => set('description', v)} placeholder="One paragraph, as you would say it to a customer." className="md:col-span-2" />
          <TextAreaField label="Products and offers" rows={3} value={form.products} onChange={(v) => set('products', v)} placeholder="List them with prices if you can. 'Dnyaneshwari ebook ₹199, bundle of 5 ₹699…'" />
          <TextAreaField label="Why customers choose you" rows={3} value={form.usp} onChange={(v) => set('usp', v)} placeholder="The one thing a competitor cannot say." />
        </div>
      </Section>

      <Section title="Language and script" description="The AI writes every headline and primary text in this language. The script matters: Marathi in Devanagari, not romanised.">
        <div className="space-y-5">
          <Field label="Primary language" hint={lang ? `Ads will read like: ${lang.native}` : undefined}>
            {() => (
              <ChipGroup
                size="sm"
                value={form.primaryLanguage}
                onChange={(v) => v && set('primaryLanguage', v as string)}
                options={Object.entries(LANGUAGES).map(([code, l]) => ({ value: code, label: <span>{l.native}<span className="ml-1 text-muted-foreground">{code}</span></span>, hint: l.label }))}
              />
            )}
          </Field>
          <Field label="Mixing">
            {() => (
              <ChipGroup
                size="sm"
                value={form.languageMode}
                onChange={(v) => v && set('languageMode', v as LanguageMode)}
                options={[
                  { value: 'single', label: 'One language only' },
                  { value: 'mixed', label: 'Code-switch naturally', hint: 'e.g. Marathi with English product words, the way local ads talk' },
                ]}
              />
            )}
          </Field>
          <Field label="Also understood" hint={form.languageMode === 'mixed' ? 'These get woven in.' : 'Used only if you ask for them.'}>
            {() => (
              <ChipGroup
                multi size="sm"
                value={form.secondaryLanguages}
                onChange={(v) => set('secondaryLanguages', (v as string[]) || [])}
                options={Object.entries(LANGUAGES).filter(([c]) => c !== form.primaryLanguage).map(([code, l]) => ({ value: code, label: l.native, hint: l.label }))}
              />
            )}
          </Field>
        </div>
      </Section>

      <Section title="Market" description="Where the ads run and what money they are counted in.">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Country">
              {() => <ChipGroup size="sm" value={form.marketCountry} onChange={(v) => v && set('marketCountry', v as string)} options={COUNTRIES} />}
            </Field>
            <Field label="Currency">
              {() => <ChipGroup size="sm" value={form.currency} onChange={(v) => v && set('currency', v as string)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TagInput label="States or regions" value={form.marketRegions} onChange={(v) => set('marketRegions', v)} placeholder="Maharashtra, Goa…" hint="Press Enter after each. These become the campaign targeting." />
            <TagInput label="Cities" value={form.marketCities} onChange={(v) => set('marketCities', v)} placeholder="Pune, Nashik, Mumbai…" hint="Optional. Narrower than regions." />
          </div>
        </div>
      </Section>

      <Section title="Audience and voice" description="Who the ads talk to, and how.">
        <div className="space-y-4">
          <TextAreaField label="Target audience" required rows={3} value={form.targetAudience} onChange={(v) => set('targetAudience', v)} placeholder="Marathi-speaking readers aged 25 to 55 who buy spiritual and self-help books online." />
          <Field label="Tone of voice">
            {() => (
              <ChipGroup size="sm" value={TONES.includes(form.tone) ? form.tone : null} onChange={(v) => set('tone', (v as string) || '')} options={TONES.map((t) => ({ value: t, label: t }))} />
            )}
          </Field>
          <TextField label="Or describe the tone yourself" value={form.tone} onChange={(v) => set('tone', v)} placeholder="Respectful, like an elder recommending a book" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextAreaField label="Never say" rows={3} value={form.avoid} onChange={(v) => set('avoid', v)} placeholder="Discount claims we can't honour, English-only headlines, religious comparisons…" />
            <TextAreaField label="Cultural notes" rows={3} value={form.culturalNotes} onChange={(v) => set('culturalNotes', v)} placeholder="Festivals that matter, forms of address, local references that land." />
          </div>
          <TagInput label="Brand colours" value={form.brandColors} onChange={(v) => set('brandColors', v)} placeholder="#e0632b, saffron, deep blue…" hint="Used when generating images. Hex codes or plain colour names." />
          {form.brandColors.some((c) => /^#([0-9a-f]{3}){1,2}$/i.test(c)) && (
            <div className="flex gap-2" aria-label="Brand colour swatches">
              {form.brandColors.filter((c) => /^#([0-9a-f]{3}){1,2}$/i.test(c)).map((c) => (
                <span key={c} title={c} className="h-7 w-7 rounded-md border border-border" style={{ background: c }} />
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Ad defaults" description="What a new campaign starts with. You can change these per campaign.">
        <div className="space-y-5">
          <Field label="Goal">
            {() => (
              <ChipGroup size="sm" value={form.defaultObjective || null} onChange={(v) => set('defaultObjective', (v as string) || '')} options={OBJECTIVES.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))} />
            )}
          </Field>
          {form.defaultObjective && <p className="-mt-3 text-xs text-muted-foreground">{OBJECTIVES.find((o) => o.value === form.defaultObjective)?.hint}</p>}
          <Field label="Button on the ad">
            {() => (
              <ChipGroup size="sm" value={form.defaultCta || null} onChange={(v) => set('defaultCta', (v as string) || '')} options={CTAS.map((c) => ({ value: c.value, label: c.label }))} />
            )}
          </Field>
          <TextField label="Landing page for ads" required type="url" inputMode="url" value={form.landingUrl} onChange={(v) => set('landingUrl', v)} error={errors.landingUrl} placeholder="https://yourshop.in/offer" hint="Where the button sends people. A campaign cannot be published without one." />
        </div>
      </Section>

      {/* Sticky save bar: appears only when there is something to save. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur transition-transform duration-200 md:left-64 ${dirty ? 'translate-y-0' : 'translate-y-full'}`}
        aria-hidden={!dirty}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <p className="text-sm text-muted-foreground">Unsaved changes</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => saved && setForm(toForm(saved))} disabled={saving}>Discard</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="mr-1.5 h-4 w-4" />}
              Save profile
            </Button>
          </div>
        </div>
      </div>

      {!dirty && missing.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check aria-hidden="true" className="h-3.5 w-3.5 text-[var(--status-good-ink)]" /> Saved. <Sparkles aria-hidden="true" className="h-3.5 w-3.5" /> The AI Manager and creative generator use this from now on.</p>
      )}
    </div>
  )
}
