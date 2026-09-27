'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader, StatusPill, EmptyState, type StatusTone } from '@/components/ui/metric'
import { TextField, TextAreaField, ChipGroup, Field } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { AdPreview, copyLimitNotes } from '@/components/ads/ad-preview'
import { ASPECT_RATIOS, CTAS, languageLabel } from '@/lib/ai/profile-constants'
import type { CreativeReview, CreativeSuggestion } from '@/lib/ai/types'
import {
  Sparkles, Plus, Check, X, Wand2, Loader2, Trash2, Search, ImageIcon, TriangleAlert, ExternalLink,
} from 'lucide-react'

/**
 * Ad Creatives.
 *
 * The client's job on this page is one decision per card: does this ad go
 * out or not. So every creative is shown the way a customer will see it, the
 * approve and reject buttons sit on the card, and the AI's estimate is
 * labelled as an estimate. Everything else (review, improve, delete) is a
 * step away.
 */

interface AdCreative {
  id: string
  title: string
  description: string
  imageUrl: string | null
  primaryText: string | null
  headline: string | null
  callToAction: string | null
  targeting: string | null
  expectedRoas: number | null
  actualRoas: number | null
  actualSpend: number | null
  impressions: number | null
  clicks: number | null
  conversions: number | null
  status: string
  reviewStatus: string
  reviewNotes: string | null
  language: string
  aspectRatio?: string | null
  createdAt: string
  campaign?: { id: string; name: string } | null
}

interface Profile {
  businessName: string | null
  primaryLanguage: string
  primaryLanguageLabel: string
  targetAudience: string | null
  landingUrl: string | null
  products: string | null
  defaultCta: string | null
  currency: string
}

type Filter = 'all' | 'pending' | 'approved' | 'rejected'

const REVIEW_TONE: Record<string, { tone: StatusTone; label: string }> = {
  approved: { tone: 'good', label: 'Approved' },
  rejected: { tone: 'critical', label: 'Rejected' },
  pending: { tone: 'warning', label: 'Needs review' },
}

const PRODUCT_TYPES = ['Ebook', 'Course', 'Physical product', 'Service', 'App', 'Event', 'Other']

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

export default function CreativesPage() {
  const [creatives, setCreatives] = useState<AdCreative[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const [showGenerate, setShowGenerate] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reviewFor, setReviewFor] = useState<{ creative: AdCreative; review: CreativeReview } | null>(null)
  const [suggestionFor, setSuggestionFor] = useState<{ creative: AdCreative; suggestion: CreativeSuggestion } | null>(null)
  const [deleteFor, setDeleteFor] = useState<AdCreative | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/creatives').then((r) => r.json()),
      fetch('/api/business-profile').then((r) => r.json()).catch(() => null),
    ])
      .then(([c, p]) => {
        if (cancelled) return
        setCreatives(c.creatives || [])
        setProfile(p?.profile ?? null)
      })
      .catch(() => toast.error('Could not load creatives'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  const counts = useMemo(() => ({
    all: creatives.length,
    pending: creatives.filter((c) => c.reviewStatus === 'pending').length,
    approved: creatives.filter((c) => c.reviewStatus === 'approved').length,
    rejected: creatives.filter((c) => c.reviewStatus === 'rejected').length,
  }), [creatives])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return creatives.filter((c) => {
      if (filter !== 'all' && c.reviewStatus !== filter) return false
      if (!q) return true
      return [c.title, c.headline, c.primaryText, c.campaign?.name].some((s) => s?.toLowerCase().includes(q))
    })
  }, [creatives, filter, query])

  async function patch(id: string, body: Record<string, unknown>, okMessage?: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/creatives/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Update failed')
      setCreatives((prev) => prev.map((c) => (c.id === id ? { ...c, ...json.creative } : c)))
      if (okMessage) toast.success(okMessage)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  async function aiReview(creative: AdCreative) {
    setBusyId(creative.id)
    try {
      const res = await fetch('/api/ai/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creativeId: creative.id }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Review failed')
      setReviewFor({ creative, review: json.review })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Review failed')
    } finally {
      setBusyId(null)
    }
  }

  async function aiImprove(creative: AdCreative) {
    setBusyId(creative.id)
    try {
      const res = await fetch('/api/ai/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creativeId: creative.id }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not generate an improvement')
      setSuggestionFor({ creative, suggestion: json.suggestion })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate an improvement')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(creative: AdCreative) {
    const res = await fetch(`/api/creatives/${creative.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Could not delete this creative')
      throw new Error('delete failed')
    }
    setCreatives((prev) => prev.filter((c) => c.id !== creative.id))
    toast.success('Creative deleted')
  }

  if (loading) return <PageSkeleton grid />

  const langLabel = profile ? languageLabel(profile.primaryLanguage) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ad Creatives"
        description={langLabel ? `Written in ${langLabel} for ${profile?.businessName || 'your business'}.` : 'Every ad, shown the way your customers will see it.'}
        meta={
          counts.pending > 0 ? (
            <StatusPill tone="warning">{counts.pending} waiting for your approval</StatusPill>
          ) : counts.all > 0 ? (
            <StatusPill tone="good">All reviewed</StatusPill>
          ) : null
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setShowManual(true)}>
              <Plus aria-hidden="true" className="mr-1.5 h-4 w-4" /> Add manually
            </Button>
            <Button onClick={() => setShowGenerate(true)}>
              <Sparkles aria-hidden="true" className="mr-1.5 h-4 w-4" /> Generate with AI
            </Button>
          </>
        }
      />

      {creatives.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ChipGroup<Filter>
            size="sm"
            value={filter}
            onChange={(v) => setFilter((v as Filter) || 'all')}
            options={[
              { value: 'all', label: `All · ${counts.all}` },
              { value: 'pending', label: `Needs review · ${counts.pending}` },
              { value: 'approved', label: `Approved · ${counts.approved}` },
              { value: 'rejected', label: `Rejected · ${counts.rejected}` },
            ]}
          />
          <label className="relative block sm:w-64">
            <span className="sr-only">Search creatives</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search headline or text"
              className="h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/50 dark:bg-input/30"
            />
          </label>
        </div>
      )}

      {creatives.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={ImageIcon}
            title="No creatives yet"
            description={profile?.businessName
              ? `Generate the first set. The AI already knows ${profile.businessName} and will write in ${langLabel}.`
              : 'Fill in your Business Profile first so the AI writes in the right language for the right people, then generate a set.'}
            action={
              profile?.businessName ? (
                <Button onClick={() => setShowGenerate(true)}><Sparkles aria-hidden="true" className="mr-1.5 h-4 w-4" /> Generate with AI</Button>
              ) : (
                <Button render={<Link href="/business" />} nativeButton={false}>Set up Business Profile</Button>
              )
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState icon={Search} title="Nothing matches" description="Try another filter or clear the search." />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Creatives">
          {visible.map((c) => (
            <li key={c.id} className="min-w-0">
              <CreativeCard
                creative={c}
                profile={profile}
                busy={busyId === c.id}
                onApprove={() => patch(c.id, { reviewStatus: 'approved' }, 'Approved')}
                onReject={() => patch(c.id, { reviewStatus: 'rejected' }, 'Rejected')}
                onReset={() => patch(c.id, { reviewStatus: 'pending' })}
                onReview={() => aiReview(c)}
                onImprove={() => aiImprove(c)}
                onDelete={() => setDeleteFor(c)}
              />
            </li>
          ))}
        </ul>
      )}

      <GenerateDialog open={showGenerate} onOpenChange={setShowGenerate} profile={profile} onDone={reload} />
      <ManualDialog open={showManual} onOpenChange={setShowManual} profile={profile} onDone={reload} />

      {reviewFor && (
        <Dialog open onOpenChange={(o) => !o && setReviewFor(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>AI review</DialogTitle>
              <DialogDescription>{reviewFor.creative.title}</DialogDescription>
            </DialogHeader>
            <ReviewBody review={reviewFor.review} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewFor(null)}>Close</Button>
              <Button onClick={() => { const c = reviewFor.creative; setReviewFor(null); aiImprove(c) }}>
                <Wand2 aria-hidden="true" className="mr-1.5 h-4 w-4" /> Improve it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {suggestionFor && (
        <Dialog open onOpenChange={(o) => !o && setSuggestionFor(null)}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Improved version</DialogTitle>
              <DialogDescription>Compare, then replace the copy or keep the original.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current</p>
                <AdPreview compact ad={toPreview(suggestionFor.creative, profile)} />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-primary">Suggested</p>
                <AdPreview compact ad={{ ...toPreview(suggestionFor.creative, profile), ...suggestionFor.suggestion }} />
              </div>
            </div>
            {suggestionFor.suggestion.reasoning && (
              <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">{suggestionFor.suggestion.reasoning}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSuggestionFor(null)}>Keep original</Button>
              <Button
                onClick={async () => {
                  const { creative, suggestion } = suggestionFor
                  setSuggestionFor(null)
                  await patch(creative.id, {
                    title: suggestion.title, description: suggestion.description, primaryText: suggestion.primaryText,
                    headline: suggestion.headline, callToAction: suggestion.callToAction, targeting: suggestion.targeting,
                    reviewStatus: 'pending',
                  }, 'Copy replaced. It needs approval again.')
                }}
              >
                Use suggested copy
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={Boolean(deleteFor)}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        title="Delete this creative?"
        description={`"${deleteFor?.title}" will be removed. Ads already published to Meta are not affected.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => (deleteFor ? remove(deleteFor) : undefined)}
      />
    </div>
  )
}

function toPreview(c: AdCreative, profile: Profile | null) {
  return {
    pageName: profile?.businessName,
    primaryText: c.primaryText,
    headline: c.headline,
    callToAction: c.callToAction,
    imageUrl: c.imageUrl,
    aspectRatio: c.aspectRatio,
    linkHost: hostOf(profile?.landingUrl),
    language: c.language,
  }
}

function CreativeCard({
  creative: c, profile, busy, onApprove, onReject, onReset, onReview, onImprove, onDelete,
}: {
  creative: AdCreative
  profile: Profile | null
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onReset: () => void
  onReview: () => void
  onImprove: () => void
  onDelete: () => void
}) {
  const review = REVIEW_TONE[c.reviewStatus] ?? { tone: 'neutral' as StatusTone, label: c.reviewStatus }
  const notes = copyLimitNotes(toPreview(c, profile))
  const hasResults = (c.impressions ?? 0) > 0

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={c.title}>{c.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {c.campaign?.name ? `In ${c.campaign.name}` : 'Not in a campaign'} · {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
        </div>
        <StatusPill tone={review.tone}>{review.label}</StatusPill>
      </div>

      <AdPreview compact ad={toPreview(c, profile)} />

      {notes.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-[var(--status-warning)]/10 px-3 py-2 text-xs leading-snug text-amber-800 dark:text-amber-200">
          {notes.map((n) => (
            <li key={n} className="flex gap-1.5"><TriangleAlert aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />{n}</li>
          ))}
        </ul>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/60 px-2 py-1.5">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{hasResults ? 'Real ROAS' : 'Est. ROAS'}</dt>
          <dd className="text-sm font-semibold tabular">{hasResults ? `${(c.actualRoas ?? 0).toFixed(1)}×` : c.expectedRoas != null ? `~${c.expectedRoas.toFixed(1)}×` : '—'}</dd>
        </div>
        <div className="rounded-lg bg-muted/60 px-2 py-1.5">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Clicks</dt>
          <dd className="text-sm font-semibold tabular">{c.clicks ?? '—'}</dd>
        </div>
        <div className="rounded-lg bg-muted/60 px-2 py-1.5">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Sales</dt>
          <dd className="text-sm font-semibold tabular">{c.conversions ?? '—'}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center gap-2 pt-1">
        {c.reviewStatus === 'pending' ? (
          <>
            <Button size="sm" className="flex-1" onClick={onApprove} disabled={busy}>
              <Check aria-hidden="true" className="mr-1 h-4 w-4" /> Approve
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={onReject} disabled={busy}>
              <X aria-hidden="true" className="mr-1 h-4 w-4" /> Reject
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" className="flex-1" onClick={onReset} disabled={busy}>Send back to review</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onReview} disabled={busy} aria-label="AI review" title="AI review">
          {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Sparkles aria-hidden="true" className="h-4 w-4" />}
        </Button>
        <Button size="sm" variant="ghost" onClick={onImprove} disabled={busy} aria-label="Improve with AI" title="Improve with AI">
          <Wand2 aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy} aria-label="Delete" title="Delete" className="text-muted-foreground hover:text-[var(--status-critical-ink)]">
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function ReviewBody({ review }: { review: CreativeReview }) {
  // The reviewer scores out of 100; this used to print "68/10".
  const tone: StatusTone = review.score >= 80 ? 'good' : review.score >= 50 ? 'warning' : 'critical'
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-3xl font-semibold tabular">{review.score}<span className="text-base text-muted-foreground">/100</span></span>
        <StatusPill tone={tone}>{tone === 'good' ? 'Strong' : tone === 'warning' ? 'Needs work' : 'Weak'}</StatusPill>
      </div>
      <ReviewList title="What works" items={review.strengths} tone="good" />
      <ReviewList title="What holds it back" items={review.weaknesses} tone="critical" />
      <ReviewList title="Recommended changes" items={[...(review.recommendedChanges || []), ...(review.suggestions || [])]} tone="neutral" />
    </div>
  )
}

function ReviewList({ title, items, tone }: { title: string; items: string[]; tone: StatusTone }) {
  if (!items?.length) return null
  const dot = tone === 'good' ? 'bg-[var(--status-good)]' : tone === 'critical' ? 'bg-[var(--status-critical)]' : 'bg-muted-foreground'
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug"><span aria-hidden="true" className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />{it}</li>
        ))}
      </ul>
    </div>
  )
}

function GenerateDialog({ open, onOpenChange, profile, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; profile: Profile | null; onDone: () => void }) {
  const [form, setForm] = useState({
    productType: 'Ebook',
    productName: '',
    productDescription: '',
    targetAudience: '',
    budget: '5000',
    count: 3,
    aspectRatio: '4:5' as (typeof ASPECT_RATIOS)[number]['value'],
  })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Prefill from the profile the first time the dialog opens with one loaded.
  const [seeded, setSeeded] = useState(false)
  if (profile && !seeded) {
    setSeeded(true)
    setForm((f) => ({
      ...f,
      targetAudience: f.targetAudience || profile.targetAudience || '',
      productDescription: f.productDescription || profile.products || '',
    }))
  }

  async function submit() {
    const errs: Record<string, string> = {}
    if (!form.productName.trim()) errs.productName = 'Name the product or offer the ad is for.'
    if (!form.productDescription.trim()) errs.productDescription = 'Describe it in a sentence or two so the copy has something to say.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setBusy(true)
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, budget: Number(form.budget) || 0 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ? `${json.error}${json.hint ? ` ${json.hint}` : ''}` : 'Generation failed')
      const made = json.creatives?.length ?? 0
      toast.success(`${made} creative${made === 1 ? '' : 's'} generated${json.imagesGenerated < made ? ` (${json.imagesGenerated} with images)` : ''}`)
      for (const w of json.warnings || []) toast.warning(w)
      onOpenChange(false)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  const langLabel = profile ? languageLabel(profile.primaryLanguage) : 'your profile language'

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate creatives</DialogTitle>
          <DialogDescription>
            Copy is written in <strong className="text-foreground">{langLabel}</strong> for {profile?.businessName || 'your business'}.{' '}
            <Link href="/business" className="underline underline-offset-2">Change in Business Profile</Link>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="What kind of product?">
            {() => (
              <ChipGroup size="sm" value={form.productType} onChange={(v) => v && setForm({ ...form, productType: v as string })} options={PRODUCT_TYPES.map((p) => ({ value: p, label: p }))} />
            )}
          </Field>
          <TextField label="Product or offer name" required value={form.productName} onChange={(v) => setForm({ ...form, productName: v })} error={errors.productName} placeholder="e.g. Dnyaneshwari Simplified (ebook)" />
          <TextAreaField label="What is it and why would someone want it?" required rows={3} value={form.productDescription} onChange={(v) => setForm({ ...form, productDescription: v })} error={errors.productDescription} placeholder="Two or three sentences. Price, what's inside, who it helps." />
          <TextAreaField label="Who should see this ad?" rows={2} value={form.targetAudience} onChange={(v) => setForm({ ...form, targetAudience: v })} hint="Prefilled from your profile. Narrow it for this campaign if you like." />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label={`Planned budget (${profile?.currency || 'INR'})`} inputMode="numeric" value={form.budget} onChange={(v) => setForm({ ...form, budget: v.replace(/[^\d]/g, '') })} hint="Only used to shape the offer. Nothing is spent." />
            <Field label="How many variations?">
              {() => (
                <ChipGroup size="sm" value={String(form.count)} onChange={(v) => v && setForm({ ...form, count: Number(v) })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} />
              )}
            </Field>
          </div>

          <Field label="Image shape" hint="Match the placement you will run. 4:5 is the safe default for feed.">
            {() => (
              <ChipGroup
                size="sm"
                value={form.aspectRatio}
                onChange={(v) => v && setForm({ ...form, aspectRatio: v as typeof form.aspectRatio })}
                options={ASPECT_RATIOS.map((r) => ({ value: r.value, label: `${r.label} · ${r.placement}` }))}
              />
            )}
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles aria-hidden="true" className="mr-1.5 h-4 w-4" />}
            {busy ? 'Writing and drawing…' : `Generate ${form.count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ManualDialog({ open, onOpenChange, profile, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; profile: Profile | null; onDone: () => void }) {
  const [form, setForm] = useState({ title: '', primaryText: '', headline: '', description: '', callToAction: 'LEARN_MORE', imageUrl: '' })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const preview = {
    pageName: profile?.businessName,
    primaryText: form.primaryText,
    headline: form.headline,
    callToAction: form.callToAction,
    imageUrl: form.imageUrl || null,
    linkHost: hostOf(profile?.landingUrl),
    language: profile?.primaryLanguage,
  }

  async function submit() {
    const errs: Record<string, string> = {}
    if (!form.title.trim()) errs.title = 'Give it a name so you can find it later.'
    if (!form.primaryText.trim()) errs.primaryText = 'The primary text is what people read first.'
    if (!form.headline.trim()) errs.headline = 'A headline is required for a link ad.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const res = await fetch('/api/creatives', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, description: form.description || form.headline, imageUrl: form.imageUrl || null, status: 'draft', reviewStatus: 'pending' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save')
      toast.success('Creative added')
      setForm({ title: '', primaryText: '', headline: '', description: '', callToAction: 'LEARN_MORE', imageUrl: '' })
      onOpenChange(false)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add a creative by hand</DialogTitle>
          <DialogDescription>Paste copy you already have. The preview updates as you type.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <TextField label="Internal name" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} error={errors.title} placeholder="Diwali offer, v1" />
            <TextAreaField label="Primary text" required rows={4} maxLength={125} lang={profile?.primaryLanguage} value={form.primaryText} onChange={(v) => setForm({ ...form, primaryText: v })} error={errors.primaryText} hint="Shown above the image. About 125 characters stay visible before 'See more'." />
            <TextField label="Headline" required maxLength={40} value={form.headline} onChange={(v) => setForm({ ...form, headline: v })} error={errors.headline} hint="Bold line under the image. About 40 characters." />
            <TextField label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} hint="Optional small line under the headline." />
            <Field label="Button">
              {({ id }) => (
                <Select value={form.callToAction} onValueChange={(v) => { if (v) setForm({ ...form, callToAction: v }) }}>
                  <SelectTrigger id={id} className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{CTAS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </Field>
            <TextField label="Image URL" type="url" inputMode="url" value={form.imageUrl} onChange={(v) => setForm({ ...form, imageUrl: v })} hint="A direct link to a JPG or PNG. Leave blank to add one later." />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <AdPreview compact ad={preview} />
            {profile?.landingUrl && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><ExternalLink aria-hidden="true" className="h-3 w-3" /> Links to {hostOf(profile.landingUrl)}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />} Save creative
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
