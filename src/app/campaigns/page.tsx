'use client'

import { useEffect, useMemo, useState } from 'react'
import { isApproved } from '@/lib/ai/review-status'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader, StatTile, StatusPill, EmptyState, formatCurrency, formatCompact, type StatusTone } from '@/components/ui/metric'
import { TextField, ChipGroup, TagInput, Field, SwitchRow } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { OBJECTIVES, LANGUAGES } from '@/lib/ai/profile-constants'
import { Plus, Play, Pause, Rocket, Trash2, Loader2, Megaphone, ExternalLink, TriangleAlert, Check } from 'lucide-react'

/**
 * Campaigns.
 *
 * A campaign here is a plan until it is published to Meta, and even then it
 * goes up PAUSED. The page makes that state visible on every card, because
 * the single most expensive confusion on an ads tool is "is this spending
 * right now?".
 */

interface Campaign {
  id: string
  name: string
  objective: string
  status: string
  budget: number
  budgetType: string
  startDate: string | null
  endDate: string | null
  metaCampaignId: string | null
  totalSpend: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  createdAt: string
  _count?: { adCreatives: number }
}

interface Creative { id: string; title: string; headline: string | null; reviewStatus: string; imageUrl: string | null; campaign?: { id: string } | null }
interface Profile { landingUrl: string | null; marketRegions: string[]; marketCities: string[]; marketCountry: string; primaryLanguage: string; currency: string; defaultObjective: string | null }
interface Assets { connected: boolean; error?: string; pages: Array<{ id: string; name: string }>; pixels: Array<{ id: string; name: string }> }

function statusInfo(c: Campaign): { tone: StatusTone; label: string; hint: string } {
  const s = c.status.toUpperCase()
  if (!c.metaCampaignId) return { tone: 'neutral', label: 'Draft', hint: 'Only on this platform. Not on Meta yet.' }
  if (s === 'ACTIVE') return { tone: 'good', label: 'Live', hint: 'Delivering and spending on Meta.' }
  if (s === 'PAUSED') return { tone: 'warning', label: 'Paused on Meta', hint: 'Published but not spending.' }
  if (s === 'ARCHIVED' || s === 'DELETED') return { tone: 'neutral', label: 'Archived', hint: 'No longer runs.' }
  return { tone: 'neutral', label: c.status, hint: '' }
}

function objectiveLabel(v: string) { return OBJECTIVES.find((o) => o.value === v)?.label ?? v.replace('OUTCOME_', '').toLowerCase() }

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [publishFor, setPublishFor] = useState<Campaign | null>(null)
  const [deleteFor, setDeleteFor] = useState<Campaign | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/campaigns').then((r) => r.json()),
      fetch('/api/business-profile').then((r) => r.json()).catch(() => null),
    ]).then(([c, p]) => {
      if (cancelled) return
      setCampaigns(c.campaigns || [])
      setProfile(p?.profile ?? null)
    }).catch(() => toast.error('Could not load campaigns')).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = () => setReloadKey((k) => k + 1)
  const currency = profile?.currency || 'INR'

  const totals = useMemo(() => ({
    live: campaigns.filter((c) => c.metaCampaignId && c.status.toUpperCase() === 'ACTIVE').length,
    dailyBudget: campaigns.filter((c) => c.metaCampaignId && c.status.toUpperCase() === 'ACTIVE' && c.budgetType === 'daily').reduce((s, c) => s + c.budget, 0),
    spend: campaigns.reduce((s, c) => s + (c.totalSpend || 0), 0),
    conversions: campaigns.reduce((s, c) => s + (c.totalConversions || 0), 0),
  }), [campaigns])

  async function setStatus(c: Campaign, status: 'ACTIVE' | 'PAUSED') {
    setBusyId(c.id)
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Update failed')
      setCampaigns((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...j.campaign } : x)))
      toast.success(status === 'ACTIVE' ? `${c.name} is live` : `${c.name} paused`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(c: Campaign) {
    const res = await fetch(`/api/campaigns/${c.id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Could not delete'); throw new Error('delete failed') }
    setCampaigns((prev) => prev.filter((x) => x.id !== c.id))
    toast.success('Campaign deleted')
  }

  if (loading) return <PageSkeleton rows={3} />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Plans, and what is live. Everything publishes paused; going live is a separate click."
        actions={<Button onClick={() => setShowCreate(true)}><Plus aria-hidden="true" className="mr-1.5 h-4 w-4" /> New campaign</Button>}
      />

      {campaigns.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Live now" value={totals.live} tone={totals.live > 0 ? 'good' : undefined} sub={totals.live ? 'spending on Meta' : 'nothing is spending'} />
          <StatTile label="Daily budget, live" value={formatCurrency(totals.dailyBudget, currency)} sub="sum of live daily budgets" />
          <StatTile label="Spent to date" value={formatCurrency(totals.spend, currency)} sub="across all campaigns" />
          <StatTile label="Conversions" value={formatCompact(totals.conversions)} sub="purchases or leads" />
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState icon={Megaphone} title="No campaigns yet" description="Create one here, or ask the AI Manager to plan one from your Business Profile." action={<Button onClick={() => setShowCreate(true)}><Plus aria-hidden="true" className="mr-1.5 h-4 w-4" /> New campaign</Button>} />
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Campaigns">
          {campaigns.map((c) => {
            const st = statusInfo(c)
            const busy = busyId === c.id
            const live = c.metaCampaignId && c.status.toUpperCase() === 'ACTIVE'
            return (
              <li key={c.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold">{c.name}</h2>
                      <StatusPill tone={st.tone}>{st.label}</StatusPill>
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{objectiveLabel(c.objective)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {st.hint} {c._count ? `· ${c._count.adCreatives} creative${c._count.adCreatives === 1 ? '' : 's'}` : ''}
                      {c.startDate ? ` · from ${new Date(c.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                      {c.endDate ? ` to ${new Date(c.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                    </p>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
                      <Metric label={c.budgetType === 'daily' ? 'Daily budget' : 'Lifetime budget'} value={formatCurrency(c.budget, currency)} />
                      <Metric label="Spent" value={formatCurrency(c.totalSpend || 0, currency)} />
                      <Metric label="Impressions" value={formatCompact(c.totalImpressions || 0)} />
                      <Metric label="Clicks" value={formatCompact(c.totalClicks || 0)} />
                      <Metric label="Conversions" value={formatCompact(c.totalConversions || 0)} />
                    </dl>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                    {!c.metaCampaignId ? (
                      <Button size="sm" onClick={() => setPublishFor(c)} disabled={busy}><Rocket aria-hidden="true" className="mr-1.5 h-4 w-4" /> Publish to Meta</Button>
                    ) : live ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus(c, 'PAUSED')} disabled={busy}>{busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Pause aria-hidden="true" className="mr-1.5 h-4 w-4" />} Pause</Button>
                    ) : (
                      <Button size="sm" onClick={() => setStatus(c, 'ACTIVE')} disabled={busy}>{busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Play aria-hidden="true" className="mr-1.5 h-4 w-4" />} Go live</Button>
                    )}
                    {c.metaCampaignId && (
                      <Button size="sm" variant="ghost" render={<a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${c.metaCampaignId}`} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
                        <ExternalLink aria-hidden="true" className="mr-1.5 h-4 w-4" /> Ads Manager
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} title="Delete" onClick={() => setDeleteFor(c)} disabled={busy} className="text-muted-foreground hover:text-[var(--status-critical-ink)]"><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <CreateDialog open={showCreate} onOpenChange={setShowCreate} profile={profile} onDone={reload} />
      {publishFor && <PublishDialog campaign={publishFor} profile={profile} onOpenChange={(o) => !o && setPublishFor(null)} onDone={() => { setPublishFor(null); reload() }} />}
      <ConfirmDialog
        open={Boolean(deleteFor)}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        title="Delete this campaign?"
        description={deleteFor?.metaCampaignId ? `"${deleteFor.name}" is removed here. The Meta campaign stays as it is; pause or delete it in Ads Manager.` : `"${deleteFor?.name}" will be removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => (deleteFor ? remove(deleteFor) : undefined)}
      />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular">{value}</dd>
    </div>
  )
}

function CreateDialog({ open, onOpenChange, profile, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; profile: Profile | null; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', objective: profile?.defaultObjective || 'OUTCOME_SALES', budget: '500', budgetType: 'daily', startDate: '', endDate: '' })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const currency = profile?.currency || 'INR'

  async function submit() {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'Name the campaign so you recognise it in Ads Manager.'
    const budget = Number(form.budget)
    if (!Number.isFinite(budget) || budget < 100) errs.budget = `Enter at least ${formatCurrency(100, currency)}.`
    if (form.startDate && form.endDate && form.endDate < form.startDate) errs.endDate = 'End date is before the start date.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, budget, startDate: form.startDate || null, endDate: form.endDate || null, status: 'draft' }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not create')
      toast.success('Campaign created as a draft')
      setForm({ name: '', objective: profile?.defaultObjective || 'OUTCOME_SALES', budget: '500', budgetType: 'daily', startDate: '', endDate: '' })
      onOpenChange(false); onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>Saved as a draft. Nothing reaches Meta until you publish.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <TextField label="Name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} error={errors.name} placeholder="Diwali ebook bundle, Maharashtra" />
          <Field label="Goal" hint={OBJECTIVES.find((o) => o.value === form.objective)?.hint}>
            {() => <ChipGroup size="sm" value={form.objective} onChange={(v) => v && setForm({ ...form, objective: v as string })} options={OBJECTIVES.map((o) => ({ value: o.value, label: o.label }))} />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label={`Budget (${currency})`} required inputMode="numeric" value={form.budget} onChange={(v) => setForm({ ...form, budget: v.replace(/[^\d]/g, '') })} error={errors.budget} />
            <Field label="Budget type">
              {() => <ChipGroup size="sm" value={form.budgetType} onChange={(v) => v && setForm({ ...form, budgetType: v as string })} options={[{ value: 'daily', label: 'Per day' }, { value: 'lifetime', label: 'Whole campaign' }]} />}
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Start" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} hint="Blank means as soon as it goes live." />
            <TextField label="End" type="date" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} error={errors.endDate} hint="Blank means until you pause it." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />} Create draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PublishDialog({ campaign, profile, onOpenChange, onDone }: { campaign: Campaign; profile: Profile | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [creatives, setCreatives] = useState<Creative[] | null>(null)
  const [assets, setAssets] = useState<Assets | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string; warnings: string[]; metaCampaignId?: string } | null>(null)
  const [form, setForm] = useState({
    creativeIds: [] as string[],
    linkUrl: profile?.landingUrl || '',
    pageId: '',
    pixelId: '',
    conversionEvent: 'PURCHASE',
    regions: profile?.marketRegions || [],
    cities: profile?.marketCities || [],
    ageMin: '18',
    ageMax: '65',
    genders: [] as string[],
    languages: profile ? [LANGUAGES[profile.primaryLanguage]?.label.split(' (')[0] || profile.primaryLanguage] : [],
    advantageAudience: true,
    activate: false,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/creatives').then((r) => r.json()).then((j) => setCreatives((j.creatives || []) as Creative[])).catch(() => setCreatives([]))
    fetch('/api/meta/assets').then((r) => r.json()).then((j) => {
      setAssets(j)
      if (j.pages?.length === 1) setForm((f) => ({ ...f, pageId: j.pages[0].id }))
      if (j.pixels?.length === 1) setForm((f) => ({ ...f, pixelId: j.pixels[0].id }))
    }).catch(() => setAssets({ connected: false, pages: [], pixels: [] }))
  }, [])

  const approved = (creatives || []).filter((c) => isApproved(c.reviewStatus))
  const isSales = campaign.objective === 'OUTCOME_SALES'

  async function publish() {
    const errs: Record<string, string> = {}
    if (!form.creativeIds.length) errs.creativeIds = 'Pick at least one approved creative.'
    try { new URL(form.linkUrl) } catch { errs.linkUrl = 'Enter the full landing page address.' }
    if (!form.pageId) errs.pageId = assets?.pages.length ? 'Choose the Page the ad is published from.' : 'No Facebook Page is visible to this token. Regenerate it with the pages_* permissions on the Meta Connection page.'
    if (isSales && !form.pixelId && assets?.pixels.length) errs.pixelId = 'A Sales campaign needs a Pixel to optimise against.'
    const ageMin = Number(form.ageMin), ageMax = Number(form.ageMax)
    if (ageMin < 13 || ageMax > 65 || ageMin > ageMax) errs.age = 'Ages must be between 13 and 65, low to high.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setBusy(true)
    try {
      const res = await fetch('/api/meta/publish-campaign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          creativeIds: form.creativeIds,
          linkUrl: form.linkUrl,
          pageId: form.pageId,
          pixelId: isSales ? form.pixelId || undefined : undefined,
          conversionEvent: isSales ? form.conversionEvent : undefined,
          activate: form.activate,
          targeting: {
            regions: form.regions, cities: form.cities, countries: [profile?.marketCountry || 'IN'],
            ageMin, ageMax,
            genders: form.genders.map(Number).filter(Boolean),
            languages: form.languages,
            advantageAudience: form.advantageAudience,
          },
        }),
      })
      const j = await res.json()
      setResult({ success: Boolean(j.success), message: j.message || j.error || (res.ok ? 'Published' : 'Publish failed'), warnings: j.warnings || [], metaCampaignId: j.metaCampaignId })
      if (j.success) toast.success(form.activate ? 'Published and live' : 'Published, paused')
      else toast.error(j.message || j.error || 'Publish failed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publish “{campaign.name}” to Meta</DialogTitle>
          <DialogDescription>Creates the campaign, one ad set and one ad per creative. {formatCurrency(campaign.budget, profile?.currency || 'INR')} {campaign.budgetType === 'daily' ? 'per day' : 'lifetime'}.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-border p-4">
              {result.success ? <Check aria-hidden="true" className="mt-0.5 h-5 w-5 text-[var(--status-good-ink)]" /> : <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 text-[var(--status-critical-ink)]" />}
              <div className="space-y-1">
                <p className="text-sm font-medium">{result.message}</p>
                {result.metaCampaignId && <p className="text-xs text-muted-foreground tabular">Meta campaign ID {result.metaCampaignId}</p>}
              </div>
            </div>
            {result.warnings.length > 0 && (
              <ul className="space-y-1.5 rounded-lg bg-[var(--status-warning)]/10 p-3 text-xs leading-snug text-amber-800 dark:text-amber-200">
                {result.warnings.map((w, i) => <li key={i} className="flex gap-2"><TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>)}
              </ul>
            )}
            <DialogFooter><Button onClick={result.success ? onDone : () => setResult(null)}>{result.success ? 'Done' : 'Back'}</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <Field label="Creatives to run" required error={errors.creativeIds} hint={creatives && approved.length === 0 ? 'No approved creatives yet. Approve some on the Ad Creatives page first.' : 'Only approved creatives can go live.'}>
              {() => creatives === null ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-muted-foreground" /> : approved.length === 0 ? (
                <Button size="sm" variant="outline" render={<Link href="/creatives" />} nativeButton={false}>Go to Ad Creatives</Button>
              ) : (
                <ChipGroup multi size="sm" value={form.creativeIds} onChange={(v) => setForm({ ...form, creativeIds: (v as string[]) || [] })} options={approved.map((c) => ({ value: c.id, label: c.headline || c.title, hint: c.imageUrl ? undefined : 'No image' }))} />
              )}
            </Field>

            <TextField label="Landing page" required type="url" inputMode="url" value={form.linkUrl} onChange={(v) => setForm({ ...form, linkUrl: v })} error={errors.linkUrl} placeholder="https://" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Facebook Page" required error={errors.pageId} hint={assets && !assets.pages.length ? 'None visible to this token.' : undefined}>
                {({ id }) => (
                  <Select value={form.pageId} onValueChange={(v) => { if (v) setForm({ ...form, pageId: v }) }} disabled={!assets?.pages.length}>
                    <SelectTrigger id={id} className="h-10 w-full"><SelectValue placeholder={assets ? (assets.pages.length ? 'Choose a Page' : 'No Pages found') : 'Loading…'} /></SelectTrigger>
                    <SelectContent>{assets?.pages.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </Field>
              {isSales && (
                <Field label="Pixel" error={errors.pixelId} hint={assets && !assets.pixels.length ? 'No Pixel on this account. Sales tracking will be blind until one is installed.' : 'Purchases are counted through this.'}>
                  {({ id }) => (
                    <Select value={form.pixelId} onValueChange={(v) => { if (v) setForm({ ...form, pixelId: v }) }} disabled={!assets?.pixels.length}>
                      <SelectTrigger id={id} className="h-10 w-full"><SelectValue placeholder={assets ? (assets.pixels.length ? 'Choose a Pixel' : 'No Pixel found') : 'Loading…'} /></SelectTrigger>
                      <SelectContent>{assets?.pixels.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </Field>
              )}
            </div>

            <fieldset className="space-y-4 rounded-lg border border-border p-4">
              <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Who sees it</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TagInput label="States or regions" value={form.regions} onChange={(v) => setForm({ ...form, regions: v })} placeholder="Maharashtra" />
                <TagInput label="Cities" value={form.cities} onChange={(v) => setForm({ ...form, cities: v })} placeholder="Pune, Nashik" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TextField label="Age from" inputMode="numeric" value={form.ageMin} onChange={(v) => setForm({ ...form, ageMin: v.replace(/\D/g, '') })} error={errors.age} />
                <TextField label="Age to" inputMode="numeric" value={form.ageMax} onChange={(v) => setForm({ ...form, ageMax: v.replace(/\D/g, '') })} />
                <Field label="Gender">
                  {() => <ChipGroup multi size="sm" value={form.genders} onChange={(v) => setForm({ ...form, genders: (v as string[]) || [] })} options={[{ value: '1', label: 'Men' }, { value: '2', label: 'Women' }]} />}
                </Field>
              </div>
              <TagInput label="Languages people use on Facebook" value={form.languages} onChange={(v) => setForm({ ...form, languages: v })} placeholder="Marathi" hint="Resolved to Meta locales at publish time." />
              <SwitchRow label="Let Meta widen the audience" description="Advantage+ audience. Usually cheaper results once the Pixel has data." control={<Switch checked={form.advantageAudience} onCheckedChange={(v) => setForm({ ...form, advantageAudience: v })} />} className="py-1" />
            </fieldset>

            <SwitchRow
              label="Start spending immediately"
              description={form.activate ? `Ads go live the moment Meta approves them and spend ${formatCurrency(campaign.budget, profile?.currency || 'INR')} ${campaign.budgetType === 'daily' ? 'per day' : 'in total'}.` : 'Off: everything is created paused. Review it in Ads Manager, then press Go live here.'}
              control={<Switch checked={form.activate} onCheckedChange={(v) => setForm({ ...form, activate: v })} />}
              className={form.activate ? 'rounded-lg bg-[var(--status-warning)]/10 px-3' : 'px-3'}
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={publish} disabled={busy || !assets}>
                {busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Rocket aria-hidden="true" className="mr-1.5 h-4 w-4" />}
                {busy ? 'Publishing…' : form.activate ? 'Publish and go live' : 'Publish paused'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
