'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Circle,
  Coins,
  Plug,
  Target,
  TrendingUp,
  Link2,
  Megaphone,
  RefreshCw,
  Sparkles,
  Wallet,
} from 'lucide-react'
import {
  Delta,
  EmptyState,
  PacingBar,
  Section,
  Sparkline,
  StatTile,
  StatusPill,
  formatCompact,
  formatCurrency,
  type StatusTone,
} from '@/components/ui/metric'
import dynamic from 'next/dynamic'
import type { TrendPoint } from '@/components/charts/trend-chart'
import { AiOrb } from '@/components/chat/ai-orb'
import { normalizeReview } from '@/lib/ai/review-status'

// Client-only. Recharts writes colours into SVG presentation attributes, which
// cannot read CSS custom properties, so the hue is resolved in JS — and the
// server has no theme to resolve against. Server-rendering the plot would
// mismatch on hydration every single load.
const TrendChart = dynamic(() => import('@/components/charts/trend-chart').then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <div className="h-[300px] animate-pulse rounded-lg bg-muted" />,
})

/**
 * The dashboard answers four questions, in the order a business owner asks
 * them when they open the app:
 *
 *   1. Is anything waiting on me?      (approvals — the only interruptive item)
 *   2. Am I within budget?             (pacing — prevents the disaster)
 *   3. Is it working?                  (ROAS against the target they set)
 *   4. What changed, and what's next?  (trend, then creatives to review)
 *
 * The previous version opened with five identically-weighted stat cards and
 * two equally-sized charts, which is the same as having no hierarchy: the
 * client had to read everything to find the one thing that mattered.
 */

interface Approval {
  id: string
  summary: string
  risk: 'low' | 'medium' | 'high'
  toolName: string
  createdAt: string | null
  expiresAt: string | null
}

interface DashboardData {
  connected: boolean
  adAccount?: { name: string; accountId: string; currency: string; status: string }
  stats?: {
    totalSpend: number
    totalRevenue: number
    totalImpressions: number
    totalClicks: number
    totalConversions: number
    ctr: number
    cpc: number
    cpa: number
    roas: number
    roasNote: string | null
  }
  performanceData?: Array<{ date: string; spend: number; revenue: number }>
  recentCreatives?: Array<{
    id: string
    title: string
    status: string
    reviewStatus: string
    createdAt: string
  }>
  campaignCount?: number
  strategy?: { targetRoas: number; targetCpa: number | null; autoOptimize: boolean; focus: string | null } | null
  approvals?: Approval[]
  pendingApprovals?: number
  pacing?: { spentToday: number; spentThisMonth: number; dailyCap: number | null; monthlyCap: number | null }
  deltas?: Partial<Record<'spend' | 'revenue' | 'roas' | 'conversions' | 'cpa' | 'ctr', number | null>>
  aiConfigured: boolean
  lastSyncedAt?: string | null
  readiness?: { aiKey: boolean; profile: boolean; landingUrl: boolean; caps: boolean; research: boolean }
}

const EMPTY_STATS = {
  totalSpend: 0, totalRevenue: 0, totalImpressions: 0, totalClicks: 0,
  totalConversions: 0, ctr: 0, cpc: 0, cpa: 0, roas: 0, roasNote: null,
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `reloadKey` is the effect's only trigger. Retry and Sync bump it rather
  // than calling a fetch function directly, which keeps every setState inside
  // the effect that owns it.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false

    async function fetchDashboard() {
      try {
        const res = await fetch('/api/dashboard')
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(json.error || 'Failed to load dashboard')
        setData(json)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDashboard()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  async function handleSync() {
    setSyncing(true)
    try {
      await fetch('/api/meta/insights?level=campaign&datePreset=last_30d')
      reload()
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <DashboardSkeleton />

  // ── Not connected: one job, one path ────────────────────────────────
  if (!data?.connected) {
    return (
      <div className="mx-auto max-w-2xl space-y-8 py-8 sm:py-12">
        <div className="flex flex-col items-center text-center">
          <AiOrb size={64} />
          <div className="ai-orb-shadow mt-2 w-12" aria-hidden="true" />
          <h1 className="mt-5 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Let&apos;s get your ads running</h1>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Three steps, then the AI Manager can plan, write and run campaigns for you.
          </p>
        </div>
        <ol className="relative space-y-3 before:absolute before:bottom-8 before:left-[2.1rem] before:top-8 before:w-px before:bg-border">
          <SetupStep
            n={1}
            done={false}
            icon={Link2}
            title="Connect your Meta Ads account"
            description="So the platform can read performance and publish campaigns."
            href="/connect"
            cta="Connect"
          />
          <SetupStep
            n={2}
            done={false}
            icon={Wallet}
            title="Tell us about your business"
            description="Language, market, audience and landing page. Every ad is written from this."
            href="/business"
            cta="Set up"
          />
          <SetupStep
            n={3}
            done={Boolean(data?.aiConfigured)}
            icon={Sparkles}
            title="Set up the AI brain and budget caps"
            description="Pick an AI provider, then set the daily and monthly caps the platform enforces."
            href="/settings"
            cta="Configure"
          />
        </ol>
        {error && <ErrorBanner message={error} onRetry={reload} />}
      </div>
    )
  }

  const stats = data.stats ?? EMPTY_STATS
  const pacing = data.pacing ?? { spentToday: 0, spentThisMonth: 0, dailyCap: null, monthlyCap: null }
  const deltas = data.deltas ?? {}
  const currency = data.adAccount?.currency || 'INR'
  const targetRoas = data.strategy?.targetRoas ?? null
  const approvals = data.approvals ?? []

  const trend: TrendPoint[] = (data.performanceData ?? []).map((d) => ({
    date: d.date,
    spend: d.spend,
    revenue: d.revenue,
  }))
  const sparkSpend = trend.map((d) => d.spend)
  const sparkRevenue = trend.map((d) => d.revenue)
  const sparkRoas = trend.map((d) => (d.spend > 0 ? d.revenue / d.spend : 0))

  // ROAS is the headline, so it gets a verdict rather than a bare number.
  const hasRevenue = stats.totalRevenue > 0
  const roasTone: StatusTone = !hasRevenue
    ? 'neutral'
    : targetRoas == null
      ? 'neutral'
      : stats.roas >= targetRoas
        ? 'good'
        : stats.roas >= targetRoas * 0.75
          ? 'warning'
          : 'critical'

  const roasVerdict = !hasRevenue
    ? 'No revenue tracked yet'
    : targetRoas == null
      ? 'No target set'
      : stats.roas >= targetRoas
        ? `Above your ${targetRoas}x target`
        : `Below your ${targetRoas}x target`

  return (
    <div className="space-y-6">
      <DashboardHero
        accountName={data.adAccount?.name || 'Your ad account'}
        currency={currency}
        lastSyncedAt={data.lastSyncedAt ?? null}
        autoOptimize={Boolean(data.strategy?.autoOptimize)}
        waiting={approvals.length}
        aiReady={Boolean(data.aiConfigured)}
        syncing={syncing}
        onSync={handleSync}
      />

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {/* 1 ── Waiting on you. Above everything, because it is the only thing
             on this page that stops work until the client acts. */}
      {approvals.length > 0 && (
        <Section
          title={`${approvals.length} action${approvals.length === 1 ? '' : 's'} waiting for your approval`}
          description="These change live ad spend. Nothing happens until you approve."
          className="border-[var(--status-warning)]/45 bg-[radial-gradient(90%_120%_at_0%_0%,color-mix(in_oklch,var(--status-warning)_9%,transparent),transparent_60%)]"
          action={
            <Button size="sm" nativeButton={false} render={<Link href="/ai-manager" />}>
              Review
              <ArrowRight aria-hidden="true" className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          }
        >
          <ul className="space-y-2">
            {approvals.map((a) => (
              <li key={a.id} className="flex flex-col items-start gap-2 rounded-xl border border-border bg-background/60 p-3.5 sm:flex-row sm:justify-between sm:gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm">{a.summary}</p>
                  {a.expiresAt && (
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(a.expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  )}
                </div>
                <StatusPill tone={a.risk === 'high' ? 'critical' : a.risk === 'medium' ? 'warning' : 'neutral'} className="shrink-0">
                  {a.risk === 'high' ? 'High risk' : a.risk === 'medium' ? 'Medium risk' : 'Low risk'}
                </StatusPill>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.readiness && <ReadinessChecklist r={data.readiness} />}

      {/* 2 ── Budget. The guardrail made visible: these are the same numbers
             the server enforces, so the limit is something the client can see
             rather than something they have to trust. */}
      <Section
        title="Budget pacing"
        description="Enforced in code — the AI cannot spend past these caps."
        action={
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/settings" />}>
            Adjust caps
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <PacingBar label="Spent today" spent={pacing.spentToday} cap={pacing.dailyCap} currency={currency} />
          <PacingBar label="Spent this month" spent={pacing.spentThisMonth} cap={pacing.monthlyCap} currency={currency} />
        </div>
      </Section>

      {/* 3 ── Is it working? ROAS leads at double weight; the supporting
             measures sit beside it, deliberately smaller. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          emphasis
          label="Return on ad spend"
          icon={TrendingUp}
          spark={hasRevenue ? <Sparkline values={sparkRoas} color="var(--primary)" /> : undefined}
          value={hasRevenue ? `${stats.roas.toFixed(2)}x` : '—'}
          tone={roasTone === 'critical' ? 'critical' : roasTone === 'good' ? 'good' : undefined}
          delta={deltas.roas}
          sub={<StatusPill tone={roasTone}>{roasVerdict}</StatusPill>}
          footnote={stats.roasNote ?? undefined}
        />
        <StatTile
          label="Spend"
          icon={Wallet}
          spark={<Sparkline values={sparkSpend} color="var(--viz-1)" />}
          value={formatCurrency(stats.totalSpend, currency)}
          delta={deltas.spend}
          deltaInvert
          sub="Last 30 days"
        />
        <StatTile
          label="Revenue"
          icon={Coins}
          spark={hasRevenue ? <Sparkline values={sparkRevenue} color="var(--viz-2)" /> : undefined}
          value={hasRevenue ? formatCurrency(stats.totalRevenue, currency) : '—'}
          delta={deltas.revenue}
          sub={hasRevenue ? 'Tracked conversion value' : 'Needs a Meta Pixel'}
        />
        <StatTile
          label="Cost per result"
          icon={Target}
          value={stats.totalConversions > 0 ? formatCurrency(stats.cpa, currency) : '—'}
          delta={deltas.cpa}
          deltaInvert
          sub={
            stats.totalConversions > 0
              ? `${formatCompact(stats.totalConversions)} results${data.strategy?.targetCpa ? ` · target ${formatCurrency(data.strategy.targetCpa, currency)}` : ''}`
              : 'No conversions tracked'
          }
        />
      </div>

      {/* 4 ── What changed. One chart, one axis, two series that share a unit. */}
      <Section title="Spend and revenue" description="Daily, last 30 days. The gap between the two lines is your profit.">
        {trend.length > 0 ? (
          <TrendChart data={trend} currency={currency} />
        ) : (
          <EmptyState
            icon={Megaphone}
            title="No performance data yet"
            description="Once a campaign is live and you sync from Meta, daily spend and revenue appear here."
            action={
              <Button variant="outline" onClick={handleSync} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync from Meta'}
              </Button>
            }
          />
        )}
      </Section>

      {/* 5 ── What's next. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section
          title="Creatives awaiting review"
          description="Approve a creative before it can be published as an ad."
          action={
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/creatives" />}>
              All creatives
              <ArrowRight aria-hidden="true" className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          }
        >
          {data.recentCreatives?.length ? (
            <ul className="space-y-2">
              {data.recentCreatives.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3 transition-colors hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <StatusPill
                    tone={normalizeReview(c.reviewStatus) === 'approved' ? 'good' : normalizeReview(c.reviewStatus) === 'rejected' ? 'critical' : 'warning'}
                  >
                    {normalizeReview(c.reviewStatus) === 'approved' ? 'Approved' : normalizeReview(c.reviewStatus) === 'rejected' ? 'Rejected' : 'Needs review'}
                  </StatusPill>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No creatives yet"
              description="Generate ad copy in your language with a matching image, then review it before anything goes live."
              action={
                <Button nativeButton={false} render={<Link href="/creatives" />}>Generate a creative</Button>
              }
            />
          )}
        </Section>

        <Section title="Account" description="Where things stand right now.">
          <dl className="divide-y divide-border text-sm">
            <Row label="Campaigns" value={String(data.campaignCount ?? 0)} />
            <Row label="Impressions (30d)" value={formatCompact(stats.totalImpressions)} />
            <Row
              label="Clicks (30d)"
              value={
                <span className="inline-flex items-center gap-2">
                  {formatCompact(stats.totalClicks)}
                  <span className="text-xs text-muted-foreground tabular">{stats.ctr.toFixed(2)}% CTR</span>
                  <Delta value={deltas.ctr} />
                </span>
              }
            />
            <Row label="Target ROAS" value={targetRoas ? `${targetRoas}x` : 'Not set'} />
            <Row
              label="AI brain"
              value={
                data.aiConfigured ? (
                  <StatusPill tone="good">Configured</StatusPill>
                ) : (
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/settings" />}>
                    Set up
                  </Button>
                )
              }
            />
          </dl>
        </Section>
      </div>
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function syncedAgo(iso: string | null): string {
  if (!iso) return 'Not synced yet'
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins)) return 'Not synced yet'
  if (mins < 1) return 'Synced just now'
  if (mins < 60) return `Synced ${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `Synced ${hrs} h ago`
  return `Synced ${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
}

/**
 * The first thing the owner sees: whose account, how fresh the numbers are,
 * and what the agent is doing, with the two actions they take most.
 */
function DashboardHero({
  accountName, currency, lastSyncedAt, autoOptimize, waiting, aiReady, syncing, onSync,
}: {
  accountName: string
  currency: string
  lastSyncedAt: string | null
  autoOptimize: boolean
  waiting: number
  aiReady: boolean
  syncing: boolean
  onSync: () => void
}) {
  const agentLine = !aiReady
    ? 'Needs an AI key to start'
    : waiting > 0
      ? `${waiting} action${waiting === 1 ? '' : 's'} waiting for your approval`
      : autoOptimize
        ? 'Auto-optimise on, within your caps'
        : 'Asks you before any spend'
  return (
    <section aria-label="Overview" className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 elev-1 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_140%_at_100%_0%,color-mix(in_oklch,var(--gradient-mid)_13%,transparent),transparent_62%),radial-gradient(45%_110%_at_0%_100%,color-mix(in_oklch,var(--primary)_8%,transparent),transparent_60%)]"
      />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{greeting()}</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight sm:text-[30px] sm:leading-tight">{accountName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground">
            <span>Last 30 days · {currency}</span>
            <button
              type="button"
              onClick={onSync}
              disabled={syncing}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 -mx-2 font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : syncedAgo(lastSyncedAt)}
              <span className="sr-only">. Sync now</span>
            </button>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-background/70 p-3 pr-3.5 xl:w-[400px]">
          <AiOrb size={40} working={syncing} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">AI Manager</p>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${!aiReady ? 'bg-[var(--status-warning)]' : waiting > 0 ? 'bg-[var(--status-warning)]' : 'bg-[var(--status-good)]'}`} />
              <span className="line-clamp-2 sm:truncate">{agentLine}</span>
            </p>
          </div>
          <Button size="sm" className="h-9 shrink-0 gap-1.5 rounded-full px-3.5" nativeButton={false} render={<Link href={aiReady ? '/ai-manager' : '/settings'} />}>
            {aiReady ? (waiting > 0 ? 'Review' : 'Ask') : 'Set up'}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </section>
  )
}

/** Setup progress as a ring with the count in words beside it. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 16
  const c = 2 * Math.PI * r
  const frac = total ? done / total : 0
  return (
    <div className="flex items-center gap-2.5" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="-rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--muted)" strokeWidth="4" />
        <circle
          cx="20" cy="20" r={r} fill="none" stroke="url(#ring-grad)" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
          className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--gradient-start)" />
            <stop offset="100%" stopColor="var(--gradient-mid)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-sm font-semibold tabular">{done}<span className="font-normal text-muted-foreground">/{total} done</span></span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular">{value}</dd>
    </div>
  )
}

/**
 * What still stands between a connected account and its first real ad.
 * Hides itself once every item is done, so it never becomes wallpaper.
 */
function ReadinessChecklist({ r }: { r: NonNullable<DashboardData['readiness']> }) {
  const items = [
    { done: r.aiKey, title: 'AI provider key', description: 'The agent needs a key to think and write.', href: '/settings', cta: 'Add key', icon: Sparkles },
    { done: r.profile, title: 'Business profile', description: 'Who you sell to and how you talk. Every ad is written from it.', href: '/business', cta: 'Complete', icon: Megaphone },
    { done: r.landingUrl, title: 'Landing page for ads', description: 'Where people go when they tap your ad. Publishing refuses without it.', href: '/business', cta: 'Add URL', icon: Link2 },
    { done: r.caps, title: 'Daily and monthly spend caps', description: 'Hard limits the AI can never cross.', href: '/settings', cta: 'Set caps', icon: Wallet },
    { done: r.research, title: 'A research tool (optional)', description: 'Lets the agent study competitors. Tavily has a free tier.', href: '/connections', cta: 'Connect', icon: Plug },
  ]
  const remaining = items.filter((i) => !i.done)
  if (remaining.length === 0) return null
  const doneCount = items.length - remaining.length
  return (
    <Section
      title="Before your first ad goes live"
      description="Finish these and the AI Manager can build and publish for you."
      action={<ProgressRing done={doneCount} total={items.length} />}
    >
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {items.map((i) => (
          <li key={i.title} className={`flex min-w-0 items-start gap-3 rounded-xl border p-3.5 transition-colors ${i.done ? 'border-border/60 bg-muted/30' : 'border-border hover:border-primary/30'}`}>
            {i.done
              ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-good)]" />
              : <Circle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${i.done ? 'text-muted-foreground line-through decoration-muted-foreground/50' : ''}`}>
                {i.title}<span className="sr-only">{i.done ? ' (done)' : ' (to do)'}</span>
              </p>
              {!i.done && <p className="text-xs leading-relaxed text-muted-foreground">{i.description}</p>}
            </div>
            {!i.done && (
              <Button size="sm" variant="outline" className="shrink-0" nativeButton={false} render={<Link href={i.href} />}>
                {i.cta}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function SetupStep({
  n, done, icon: Icon, title, description, href, cta,
}: {
  n: number
  done: boolean
  icon: typeof Link2
  title: string
  description: string
  href: string
  cta: string
}) {
  return (
    <li className="relative flex items-center gap-4 rounded-2xl border border-border bg-card p-4 elev-1">
      <div
        className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular ${
          done ? 'border-[var(--status-good)]/30 bg-[var(--status-good)]/10 text-[var(--status-good-ink)]' : 'border-transparent bg-[linear-gradient(145deg,var(--gradient-start),var(--gradient-mid))] text-white'
        }`}
      >
        {done ? <BadgeCheck aria-hidden="true" className="h-4 w-4" /> : n}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button variant={done ? 'ghost' : 'default'} size="sm" nativeButton={false} render={<Link href={href} />}>
        <Icon aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
        {done ? 'Review' : cta}
      </Button>
    </li>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-xl border border-[var(--status-critical)]/30 bg-[var(--status-critical)]/8 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-critical-ink)]" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Could not load your dashboard</p>
          <p className="text-xs text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-32 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}
