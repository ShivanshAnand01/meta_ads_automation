'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Coins, Building2, Cpu, CalendarDays, Bot } from 'lucide-react'
import { PageHeader, Section, StatTile, EmptyState } from '@/components/ui/metric'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { getSpecialist } from '@/lib/ai/agents/registry'
import { sourceLabel } from '@/lib/ai/usage-labels'
import { cn } from '@/lib/utils'

/**
 * Running cost — for the developer only (DEVELOPER_EMAILS).
 *
 * Every paid AI call the platform makes is recorded with its tokens and price
 * (ai_usage). This page answers: what does it cost to run, per business and
 * per feature — the numbers pricing will be set from.
 */

interface Bucket { costUsd: number; calls: number; inputTokens: number; outputTokens: number; unpriced: number }
interface CostData {
  days: number
  fx: { rate: number; date: string } | null
  total: Bucket
  businessCount: number
  businesses: Array<Bucket & { userId: string; name: string; email: string | null }>
  sources: Array<Bucket & { source: string }>
  models: Array<Bucket & { model: string }>
  daily: Array<Bucket & { date: string }>
  agents: Array<{ agent: string; runs: number; failed: number; costUsd: number }>
  truncated: boolean
}

const RANGES = [7, 30, 90] as const

export default function CostsPage() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<CostData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/costs?days=${days}`)
      .then(async (r) => {
        if (r.status === 404 || r.status === 401) { if (!cancelled) setState('denied'); return }
        const j = await r.json()
        if (!r.ok) throw new Error(j?.error || 'Failed')
        if (!cancelled) { setData(j); setState('ready') }
      })
      .catch(() => { if (!cancelled) toast.error('Could not load running costs') })
    return () => { cancelled = true }
  }, [days])

  if (state === 'denied') {
    return (
      <div className="space-y-6">
        <PageHeader icon={Coins} title="Running cost" />
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState icon={Coins} title="Not available" description="This page is only for the platform's developer." />
        </div>
      </div>
    )
  }
  if (state === 'loading' || !data) return <PageSkeleton rows={3} />

  const rate = data.fx?.rate ?? null
  const usd = (v: number) => (v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`)
  const inr = (v: number) => (rate ? `₹${(v * rate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—')
  const perBusiness = data.businessCount ? data.total.costUsd / data.businessCount : 0
  const perMonthFactor = 30 / data.days

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Running cost"
        description="What the platform spends on AI, measured per call from OpenAI's own token counts. Only you can see this."
        actions={
          <div role="group" aria-label="Period" className="flex rounded-xl border border-border bg-muted/40 p-1">
            {RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => { setState('loading'); setDays(d) }}
                aria-pressed={days === d}
                className={cn(
                  'min-h-9 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  days === d ? 'bg-card text-foreground elev-1' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {d} days
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile emphasis icon={Coins} label={`Total, last ${data.days} days`} value={inr(data.total.costUsd)} sub={usd(data.total.costUsd)} />
        <StatTile icon={Building2} label="Per business" value={inr(perBusiness)} sub={`${data.businessCount} business${data.businessCount === 1 ? '' : 'es'} used AI`} />
        <StatTile icon={CalendarDays} label="Per business, per month" value={inr(perBusiness * perMonthFactor)} sub="At this period's rate" />
        <StatTile icon={Cpu} label="AI calls" value={data.total.calls.toLocaleString('en-IN')} sub={`${(data.total.inputTokens + data.total.outputTokens).toLocaleString('en-IN')} tokens`} />
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {rate
          ? <>Rupees at ₹{rate.toFixed(2)} per dollar (ECB reference rate, {data.fx?.date}). OpenAI bills in dollars.</>
          : <>Today&apos;s exchange rate could not be fetched, so amounts are shown in dollars only.</>}
        {data.total.unpriced > 0 && <> {data.total.unpriced} call{data.total.unpriced === 1 ? '' : 's'} used a model with no price on file and {data.total.unpriced === 1 ? 'is' : 'are'} counted in tokens only.</>}
        {' '}Embeddings and Groq/Ollama calls are not metered yet.
        {data.truncated && <> Only the latest 50,000 calls are included.</>}
      </p>

      {data.total.calls === 0 ? (
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState icon={Coins} title="No AI usage recorded yet" description="Costs appear here from the first chat message, routine or creative after this update." />
        </div>
      ) : (
        <>
          <Section title="By business" description="Who the cost comes from.">
            <CostTable
              head={['Business', 'Calls', 'Cost']}
              rows={data.businesses.map((b) => [
                <span key="n" className="min-w-0"><span className="block truncate font-medium">{b.name}</span>{b.email && b.email !== b.name && <span className="block truncate text-xs text-muted-foreground">{b.email}</span>}</span>,
                b.calls.toLocaleString('en-IN'),
                <Money key="m" usdValue={b.costUsd} inr={inr} usd={usd} />,
              ])}
            />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="By feature" description="Which part of the product spends it.">
              <CostTable
                head={['Feature', 'Calls', 'Cost']}
                rows={data.sources.map((s) => [sourceLabel(s.source), s.calls.toLocaleString('en-IN'), <Money key="m" usdValue={s.costUsd} inr={inr} usd={usd} />])}
              />
            </Section>
            <Section title="By model" description="Which model the money went to.">
              <CostTable
                head={['Model', 'Calls', 'Cost']}
                rows={data.models.map((m) => [<code key="c" className="text-[13px]">{m.model}</code>, m.calls.toLocaleString('en-IN'), <Money key="m" usdValue={m.costUsd} inr={inr} usd={usd} />])}
              />
            </Section>
          </div>

          {data.agents.length > 0 && (
            <Section title="Agent runs" description="Specialist runs the AI Manager delegated.">
              <CostTable
                head={['Agent', 'Runs', 'Cost']}
                rows={data.agents.map((a) => [
                  <span key="a" className="inline-flex items-center gap-2"><Bot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />{getSpecialist(a.agent)?.name ?? a.agent}</span>,
                  `${a.runs}${a.failed ? ` (${a.failed} failed)` : ''}`,
                  <Money key="m" usdValue={a.costUsd} inr={inr} usd={usd} />,
                ])}
              />
            </Section>
          )}

          <Section title="By day">
            <CostTable
              head={['Date', 'Calls', 'Cost']}
              rows={[...data.daily].reverse().map((d) => [
                new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                d.calls.toLocaleString('en-IN'),
                <Money key="m" usdValue={d.costUsd} inr={inr} usd={usd} />,
              ])}
            />
          </Section>
        </>
      )}
    </div>
  )
}

function Money({ usdValue, inr, usd }: { usdValue: number; inr: (v: number) => string; usd: (v: number) => string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium tabular">{inr(usdValue)}</span>
      <span className="ml-1.5 text-xs text-muted-foreground tabular">{usd(usdValue)}</span>
    </span>
  )
}

function CostTable({ head, rows }: { head: [string, string, string]; rows: React.ReactNode[][] }) {
  return (
    <div className="relative -mx-1 overflow-x-auto px-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-4 font-medium">{head[0]}</th>
            <th className="py-2 pr-4 text-right font-medium">{head[1]}</th>
            <th className="py-2 text-right font-medium">{head[2]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              <td className="max-w-[16rem] py-2.5 pr-4">{cells[0]}</td>
              <td className="py-2.5 pr-4 text-right tabular text-muted-foreground">{cells[1]}</td>
              <td className="py-2.5 text-right">{cells[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
