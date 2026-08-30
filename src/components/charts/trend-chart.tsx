'use client'

import { useMemo } from 'react'
import { useTheme } from 'next-themes'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCompact, formatCurrency } from '@/components/ui/metric'

/**
 * The spend-and-return trend.
 *
 * Design notes worth keeping:
 *
 * - **One axis.** Spend and revenue are both rupees, so they share a scale and
 *   the gap between the two areas *is* the profit. The previous dashboard put
 *   impressions and clicks on one chart — quantities three orders of magnitude
 *   apart, which flattens the smaller series into the baseline.
 * - **Two hues, fixed.** Spend is always blue, revenue always orange. The
 *   colour follows the meaning, so it never repaints when a filter changes.
 *   Both pass colour-vision-deficiency separation and 3:1 contrast against the
 *   card surface, in light and dark.
 * - **Legend always present**, so identity is never carried by colour alone.
 * - **Recessive chrome.** Hairline horizontal gridlines only; no vertical
 *   rules, no axis lines, no tick marks. The data should be the darkest thing
 *   in the frame.
 */

export interface TrendPoint {
  date: string
  spend: number
  revenue: number
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: Array<{ name?: string; dataKey?: string | number; value?: number; color?: string }>
  label?: string
  currency: string
}) {
  if (!active || !payload?.length) return null

  const spend = payload.find((p) => p.dataKey === 'spend')?.value ?? 0
  const revenue = payload.find((p) => p.dataKey === 'revenue')?.value ?? 0
  const roas = spend > 0 ? revenue / spend : 0

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-popover-foreground">
        {new Date(label ?? '').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
      </p>
      <dl className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </dt>
            <dd className="font-medium tabular text-popover-foreground">
              {formatCurrency(entry.value ?? 0, currency)}
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 border-t border-border pt-1">
          <dt className="text-muted-foreground">ROAS</dt>
          <dd className="font-medium tabular text-popover-foreground">{roas.toFixed(2)}x</dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * Rendered client-side only. Recharts writes colours into SVG presentation
 * attributes, which cannot read CSS custom properties, so the hue has to be
 * resolved in JS — and the server has no theme to resolve against. Skipping
 * SSR for the plot avoids a guaranteed hydration mismatch on every load.
 */
export function TrendChart({
  data,
  currency = 'INR',
  height = 260,
}: {
  data: TrendPoint[]
  currency?: string
  height?: number
}) {
  // Recharts renders SVG attributes and cannot read CSS custom properties, so
  // the tokens are resolved to literals here. These mirror --viz-1 / --viz-2
  // exactly, and the dark column is the same two hues re-stepped for the dark
  // surface — not an automatic flip.
  const { resolvedTheme } = useTheme()
  const series = useMemo(() => {
    const dark = resolvedTheme === 'dark'
    return {
      spend: dark ? '#3987e5' : '#2a78d6',
      revenue: dark ? '#d95926' : '#eb6834',
    }
  }, [resolvedTheme])

  const hasRevenue = data.some((d) => d.revenue > 0)

  return (
    <div className="w-full">
      {/* A plain HTML legend. Recharts orders its own legend by render order,
          which put the conditional revenue series first; spend leads here
          because it is the number the client is accountable for. */}
      <ul className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: 'var(--viz-1)' }} />
          Spend
        </li>
        {hasRevenue && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: 'var(--viz-2)' }} />
            Revenue
          </li>
        )}
      </ul>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={`fill-spend-${resolvedTheme ?? 'light'}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.spend} stopOpacity={0.18} />
              <stop offset="100%" stopColor={series.spend} stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id={`fill-revenue-${resolvedTheme ?? 'light'}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.revenue} stopOpacity={0.18} />
              <stop offset="100%" stopColor={series.revenue} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Horizontal hairlines only. Vertical rules add ink without adding
              information when the x-axis is already an ordered sequence. */}
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeWidth={1} />

          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--viz-axis)' }}
            minTickGap={28}
            tickFormatter={(value: string) =>
              new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tick={{ fontSize: 11, fill: 'var(--viz-axis)' }}
            tickFormatter={(value: number) => formatCompact(value)}
          />

          <Tooltip
            content={<ChartTooltip currency={currency} />}
            cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1, strokeDasharray: '3 3' }}
          />

          <Area
            type="monotone"
            dataKey="spend"
            name="Spend"
            stroke={series.spend}
            strokeWidth={2}
            fill={`url(#fill-spend-${resolvedTheme ?? 'light'})`}
            dot={false}
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
          />
          {hasRevenue && (
            <Area
              type="monotone"
              dataKey="revenue"
              name="Revenue"
              stroke={series.revenue}
              strokeWidth={2}
              fill={`url(#fill-revenue-${resolvedTheme ?? 'light'})`}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>

      {!hasRevenue && (
        <p className="mt-2 text-xs text-muted-foreground">
          Revenue is not plotted because no conversion value has been tracked yet — install the Meta Pixel and
          set a purchase value to see ROAS here.
        </p>
      )}

      {/* An accessible equivalent of the plot. Screen readers get numbers, not
          an unlabelled SVG, and it doubles as the "just show me the data" view. */}
      <details className="mt-3 group">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          View as table
        </summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <caption className="sr-only">Daily ad spend and revenue</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Date</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Spend</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.date} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    {new Date(row.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCurrency(row.spend, currency)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCurrency(row.revenue, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
