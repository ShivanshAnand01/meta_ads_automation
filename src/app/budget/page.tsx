'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageHeader, Section, StatTile, PacingBar, EmptyState, StatusPill, formatCurrency } from '@/components/ui/metric'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Wallet, ExternalLink, Receipt, Link2 } from 'lucide-react'

/**
 * Budget & Bills.
 *
 * Money in the ad account (Meta's side) next to money the platform is
 * allowed to spend (our caps). The owner needs both on one screen to answer
 * "will my ads stop tomorrow?".
 */

interface Billing {
  connected: boolean
  adAccount?: { name: string; currency: string }
  balance?: number
  spendCap?: number
  amountSpent?: number
  billingHistory?: Array<{ amount: string; currency: string; billing_date: string; status: string; invoice_url?: string }>
  campaignSpend?: Array<{ id: string; name: string; budget: number; totalSpend: number; budgetType: string; status?: string; metaCampaignId?: string | null }>
}
interface Strategy { dailyBudgetCap: number | null; monthlyBudget: number | null }

export default function BudgetPage() {
  const [data, setData] = useState<Billing | null>(null)
  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/meta/billing').then((r) => r.json()),
      fetch('/api/strategy').then((r) => r.json()).catch(() => null),
    ]).then(([b, s]) => { setData(b); setStrategy(s?.strategy ?? null) })
      .catch(() => toast.error('Could not load billing'))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !data) return <PageSkeleton rows={3} />

  if (!data.connected) {
    return (
      <div className="space-y-6">
        <PageHeader
        icon={Wallet} title="Budget & Bills" description="Balance, spend and invoices from your Meta ad account." />
        <div className="rounded-xl border border-border bg-card">
          <EmptyState icon={Link2} title="Meta is not connected" description="Connect your Meta app to see the ad account balance and billing history here." action={<Button render={<Link href="/connect" />} nativeButton={false}>Connect Meta</Button>} />
        </div>
      </div>
    )
  }

  const currency = data.adAccount?.currency || 'INR'
  const spent = data.amountSpent ?? 0
  const cap = data.spendCap ?? 0
  const balance = data.balance ?? 0
  const history = data.billingHistory ?? []
  const campaigns = data.campaignSpend ?? []
  const dailyCap = strategy?.dailyBudgetCap ?? null
  // Only campaigns actually running on Meta count against the daily cap;
  // drafts and paused campaigns were being added in and showed "over cap".
  const liveDaily = campaigns
    .filter((c) => c.budgetType === 'daily' && c.metaCampaignId && (c.status || '').toUpperCase() === 'ACTIVE')
    .reduce((s, c) => s + c.budget, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="Budget & Bills"
        description={`${data.adAccount?.name || 'Ad account'} · ${currency}`}
        meta={balance < 0 ? <StatusPill tone="good">Prepaid balance available</StatusPill> : balance > 0 ? <StatusPill tone="warning">Outstanding: {formatCurrency(balance, currency)}</StatusPill> : null}
        actions={
          <Button variant="outline" render={<a href="https://business.facebook.com/billing_hub/payment_activity" target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
            <ExternalLink aria-hidden="true" className="mr-1.5 h-4 w-4" /> Meta billing
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Owed to Meta" value={formatCurrency(Math.max(0, balance), currency)} sub="unbilled spend since the last charge" tone={balance > 0 ? undefined : 'good'} />
        <StatTile label="Spent, all time" value={formatCurrency(spent, currency)} sub="on this ad account" />
        <StatTile label="Meta spend cap" value={cap > 0 ? formatCurrency(cap, currency) : 'None'} sub={cap > 0 ? 'set inside Ads Manager' : 'no account-level limit on Meta'} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Platform guardrails" description="Caps enforced by this platform, in code, before any budget is sent." action={<Button size="sm" variant="ghost" render={<Link href="/settings" />} nativeButton={false}>Change</Button>}>
          <div className="space-y-5">
            <PacingBar label="Live daily budgets vs daily cap" spent={liveDaily} cap={dailyCap} currency={currency} />
            <PacingBar label="Spent vs Meta spend cap" spent={spent} cap={cap > 0 ? cap : null} currency={currency} />
            {!dailyCap && <p className="text-xs text-[var(--status-critical-ink)]">Set a daily cap in Settings. Without one the platform has no ceiling of its own.</p>}
          </div>
        </Section>

        <Section title="Campaign budgets" description="What each campaign is set to, and what it has spent so far.">
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No campaigns yet.</p>
          ) : (
            <ul className="space-y-4">
              {campaigns.map((c) => (
                <li key={c.id} className="min-w-0">
                  {/* A lifetime budget is a cap on total spend, so a bar fits. A
                      daily budget is a rate: comparing all-time spend to one
                      day's budget showed every running campaign "over cap". */}
                  {c.budgetType === 'daily' ? (
                    <div className="flex items-baseline justify-between gap-3 rounded-xl border border-border px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">Daily budget · spend to date {formatCurrency(c.totalSpend || 0, currency)}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular">{formatCurrency(c.budget, currency)}<span className="font-normal text-muted-foreground">/day</span></p>
                    </div>
                  ) : (
                    <PacingBar label={`${c.name} · lifetime budget`} spent={c.totalSpend || 0} cap={c.budget} currency={currency} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Billing history" description="Charges Meta has made to your payment method.">
        {history.length === 0 ? (
          <EmptyState icon={Receipt} title="No charges yet" description="Meta bills when spend reaches your payment threshold, or monthly." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium"><span className="sr-only">Invoice</span></th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-4 tabular">{new Date(h.billing_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="py-2.5 pr-4 font-medium tabular">{formatCurrency(Number(h.amount) || 0, h.currency || currency)}</td>
                    <td className="py-2.5 pr-4"><StatusPill tone={/paid|success/i.test(h.status) ? 'good' : /fail|declin/i.test(h.status) ? 'critical' : 'neutral'}>{h.status}</StatusPill></td>
                    <td className="py-2.5 text-right">{h.invoice_url && <a className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline" href={h.invoice_url} target="_blank" rel="noopener noreferrer">Invoice <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet aria-hidden="true" className="h-3.5 w-3.5" /> Funds are added and payment methods changed inside Meta. This page only reads.</p>
    </div>
  )
}
