'use client'

import { cn } from '@/lib/utils'
import { ArrowDownRight, ArrowUpRight, CheckCircle2, AlertTriangle, AlertCircle, Info, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Shared metric and status primitives.
 *
 * The rule these encode: a number the client spends money on should be
 * legible before it is decorative. Values are ink, aligned in tabular figures.
 * Colour only ever appears to mean something, and never alone — every status
 * carries an icon and a word too, because roughly 1 in 12 men has some colour
 * vision deficiency and this client's business depends on reading these.
 */

// ── Formatting ────────────────────────────────────────────────────────────

export function formatCurrency(value: number, currency = 'INR'): string {
  if (currency === 'INR') {
    // Lakh and crore are how Indian owners read money; keep them.
    if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`
    if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`
    return `₹${Math.round(value).toLocaleString('en-IN')}`
  }
  // Every other currency previously rendered as a bare number.
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      notation: Math.abs(value) >= 100_000 ? 'compact' : 'standard',
      maximumFractionDigits: Math.abs(value) >= 100_000 ? 2 : 0,
    }).format(value)
  } catch {
    return `${currency} ${Math.round(value).toLocaleString('en')}`
  }
}

export function formatCompact(value: number): string {
  if (Math.abs(value) >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}Cr`
  if (Math.abs(value) >= 100_000) return `${(value / 100_000).toFixed(1)}L`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return Math.round(value).toLocaleString('en-IN')
}

// ── Status ────────────────────────────────────────────────────────────────

export type StatusTone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral'

const STATUS_STYLE: Record<StatusTone, { icon: LucideIcon; className: string; dot: string }> = {
  good: { icon: CheckCircle2, className: 'text-[var(--status-good-ink)] bg-[var(--status-good)]/10 border-[var(--status-good)]/25', dot: 'bg-[var(--status-good)]' },
  warning: { icon: AlertTriangle, className: 'text-amber-700 dark:text-amber-300 bg-[var(--status-warning)]/12 border-[var(--status-warning)]/30', dot: 'bg-[var(--status-warning)]' },
  serious: { icon: AlertTriangle, className: 'text-orange-700 dark:text-orange-300 bg-[var(--status-serious)]/12 border-[var(--status-serious)]/30', dot: 'bg-[var(--status-serious)]' },
  critical: { icon: AlertCircle, className: 'text-[var(--status-critical-ink)] bg-[var(--status-critical)]/10 border-[var(--status-critical)]/30', dot: 'bg-[var(--status-critical)]' },
  neutral: { icon: Info, className: 'text-muted-foreground bg-muted border-border', dot: 'bg-muted-foreground' },
}

export function StatusPill({
  tone,
  children,
  icon: IconOverride,
  className,
}: {
  tone: StatusTone
  children: ReactNode
  icon?: LucideIcon
  className?: string
}) {
  const style = STATUS_STYLE[tone]
  const Icon = IconOverride ?? style.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        style.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  )
}

// ── Delta ─────────────────────────────────────────────────────────────────

/**
 * A period-over-period change.
 *
 * `invert` matters: for spend and CPA, up is bad. Encoding "green = up" would
 * congratulate the client for costs rising.
 */
export function Delta({
  value,
  invert = false,
  suffix = '%',
  pill = false,
  className,
}: {
  value: number | null | undefined
  invert?: boolean
  suffix?: string
  /** Tinted chip instead of bare text; used on stat tiles. */
  pill?: boolean
  className?: string
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={cn('text-xs text-muted-foreground', className)}>—</span>
  }

  const flat = Math.abs(value) < 0.5
  const isGood = invert ? value < 0 : value > 0
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tabular',
        pill && 'rounded-full px-1.5 py-0.5',
        flat
          ? cn('text-muted-foreground', pill && 'bg-muted')
          : isGood
            ? cn('text-[var(--status-good-ink)] dark:text-green-300', pill && 'bg-[var(--status-good)]/10')
            : cn('text-[var(--status-critical-ink)] dark:text-red-300', pill && 'bg-[var(--status-critical)]/10'),
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {Math.abs(value).toFixed(1)}
      {suffix}
      <span className="sr-only">
        {flat ? 'roughly unchanged' : value > 0 ? 'increase' : 'decrease'} versus the previous period
      </span>
    </span>
  )
}

// ── Stat tile ─────────────────────────────────────────────────────────────

/**
 * One measure. The value dominates; the label sits above it small and quiet.
 *
 * Emphasis is a deliberate choice, not a default — when every tile is the same
 * weight, the client has to read all of them to find the one that matters.
 */
export function StatTile({
  label,
  value,
  sub,
  delta,
  deltaInvert,
  emphasis = false,
  tone,
  footnote,
  icon: Icon,
  spark,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  delta?: number | null
  deltaInvert?: boolean
  emphasis?: boolean
  tone?: StatusTone
  footnote?: string
  icon?: LucideIcon
  /** A small trend under the number (see Sparkline). Decorative: the value says it. */
  spark?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 elev-1 transition-[box-shadow,border-color] duration-200 hover:elev-2',
        emphasis && 'border-primary/25 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklch,var(--gradient-mid)_9%,transparent),transparent_60%)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <span className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
              emphasis
                ? 'bg-[linear-gradient(145deg,var(--gradient-start),var(--gradient-mid))] text-white shadow-[0_2px_8px_-2px_oklch(0.52_0.22_264/0.5)]'
                : 'bg-muted text-muted-foreground',
            )}>
              <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          )}
          <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
        </div>
      </div>

      <p
        className={cn(
          'mt-3 font-semibold tracking-tight tabular',
          emphasis ? 'text-3xl sm:text-[34px] sm:leading-none' : 'text-[26px] leading-none',
          tone === 'critical' && 'text-[var(--status-critical-ink)] dark:text-red-300',
          tone === 'good' && 'text-[var(--status-good-ink)] dark:text-green-300',
        )}
      >
        {value}
      </p>

      {(sub || delta !== undefined) && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {delta !== undefined && <Delta value={delta} invert={deltaInvert} pill />}
          {sub && <div className="min-w-0">{sub}</div>}
        </div>
      )}
      {spark && <div className="-mx-1 mt-auto pt-3">{spark}</div>}
      {footnote && <p className="mt-2 text-xs leading-snug text-muted-foreground">{footnote}</p>}
    </div>
  )
}

/**
 * A tiny trend line drawn as plain SVG. No chart library, no axes: it shows
 * direction at a glance next to a number that already states the value.
 */
export function Sparkline({
  values,
  color = 'var(--viz-1)',
  height = 36,
  label,
}: {
  values: number[]
  color?: string
  height?: number
  /** Screen-reader summary; omit to hide the sparkline from assistive tech. */
  label?: string
}) {
  const pts = values.filter((v) => Number.isFinite(v))
  if (pts.length < 2 || pts.every((v) => v === pts[0])) return <div style={{ height }} aria-hidden="true" />
  const w = 100
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)] as const)
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${w},${height} L0,${height} Z`
  const id = `spark-${Math.abs(pts.reduce((a, v, i) => a + v * (i + 1), 0) | 0)}`
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Pacing bar ────────────────────────────────────────────────────────────

/**
 * Spend against a cap.
 *
 * This is the guardrail made visible. The budget limits are enforced in code,
 * but the client cannot trust a limit they cannot see, so the same numbers the
 * server checks are shown here.
 */
export function PacingBar({
  label,
  spent,
  cap,
  currency = 'INR',
  className,
}: {
  label: string
  spent: number
  cap: number | null
  currency?: string
  className?: string
}) {
  if (cap == null || cap <= 0) {
    return (
      <div className={cn('space-y-1.5', className)}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span className="text-sm font-semibold tabular">{formatCurrency(spent, currency)}</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted" />
        <p className="text-xs text-muted-foreground">No cap set. Spending is unlimited.</p>
      </div>
    )
  }

  const pct = Math.min(200, (spent / cap) * 100)
  const tone: StatusTone = pct >= 100 ? 'critical' : pct >= 80 ? 'warning' : 'good'
  const barColor =
    tone === 'critical' ? 'bg-[var(--status-critical)]' : tone === 'warning' ? 'bg-[var(--status-warning)]' : 'bg-[var(--status-good)]'

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular">
          {formatCurrency(spent, currency)}
          <span className="font-normal text-muted-foreground"> / {formatCurrency(cap, currency)}</span>
        </span>
      </div>

      <div
        className="h-2.5 overflow-hidden rounded-full bg-muted shadow-[inset_0_1px_2px_oklch(0.2_0.02_260/0.08)]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(pct)} percent of cap used`}
      >
        <div className={cn('h-full rounded-full bg-[linear-gradient(90deg,transparent,oklch(1_0_0/0.25))] transition-[width] duration-700 ease-out motion-reduce:transition-none', barColor)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>

      {/* The percentage is stated in words as well as colour. */}
      <p className="text-xs text-muted-foreground tabular">
        {pct >= 100
          ? `Over cap by ${formatCurrency(spent - cap, currency)}`
          : `${Math.round(pct)}% used · ${formatCurrency(cap - spent, currency)} left`}
      </p>
    </div>
  )
}

// ── Page header ───────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

// ── Section ───────────────────────────────────────────────────────────────

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-border bg-card elev-1', className)}>
      <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-5 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="p-5 pt-4 sm:px-6 sm:pb-6">{children}</div>
    </section>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,color-mix(in_oklch,var(--primary)_14%,transparent),color-mix(in_oklch,var(--gradient-end)_10%,transparent))] text-primary">
        <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
