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
  const symbol = currency === 'INR' ? '₹' : ''
  if (Math.abs(value) >= 10_000_000) return `${symbol}${(value / 10_000_000).toFixed(2)} Cr`
  if (Math.abs(value) >= 100_000) return `${symbol}${(value / 100_000).toFixed(2)} L`
  return `${symbol}${Math.round(value).toLocaleString('en-IN')}`
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
  className,
}: {
  value: number | null | undefined
  invert?: boolean
  suffix?: string
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
        flat
          ? 'text-muted-foreground'
          : isGood
            ? 'text-[var(--status-good-ink)]'
            : 'text-[var(--status-critical-ink)]',
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
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-4 transition-colors',
        emphasis && 'sm:p-5',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {delta !== undefined && <Delta value={delta} invert={deltaInvert} />}
      </div>

      <p
        className={cn(
          'mt-2 font-semibold tracking-tight tabular',
          emphasis ? 'text-3xl sm:text-4xl' : 'text-2xl',
          tone === 'critical' && 'text-[var(--status-critical-ink)]',
          tone === 'good' && 'text-[var(--status-good-ink)]',
        )}
      >
        {value}
      </p>

      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      {footnote && <p className="mt-2 text-[11px] leading-snug text-muted-foreground/80">{footnote}</p>}
    </div>
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
        <div className="h-2 rounded-full bg-muted" />
        <p className="text-[11px] text-muted-foreground">No cap set — spending is unlimited.</p>
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
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(pct)} percent of cap used`}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', barColor)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>

      {/* The percentage is stated in words as well as colour. */}
      <p className="text-[11px] text-muted-foreground tabular">
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
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
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
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted">
        <Icon aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
