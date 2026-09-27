'use client'

import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { ChartSpec } from './types'

// The app's validated data palette first (spend blue, revenue orange), then
// distinct hues for extra series. Recharts cannot read CSS variables.
const COLORS = ['#2a78d6', '#eb6834', '#16a34a', '#8b5cf6', '#db2777', '#ca8a04']
const TICK = { fontSize: 11, fill: '#898781' }

/** Loaded on demand: recharts is the heaviest thing a chat reply can need. */
export default function ChatChart({ spec }: { spec: ChartSpec }) {
  if (!spec?.data?.length) return <p className="text-sm text-muted-foreground">No data to chart.</p>
  const { chartType, data, xKey, title } = spec
  const yk = spec.yKeys || []
  const color = (i: number, own?: string) => own || COLORS[i % COLORS.length]
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" strokeOpacity={0.6} vertical={false} />

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'line' ? (
            <LineChart data={data}>
              {grid}
              <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={false} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {yk.map((y, i) => <Line key={y.key} type="monotone" dataKey={y.key} name={y.label} stroke={color(i, y.color)} strokeWidth={2} dot={false} isAnimationActive={false} />)}
            </LineChart>
          ) : chartType === 'area' ? (
            <AreaChart data={data}>
              {grid}
              <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={false} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {yk.map((y, i) => <Area key={y.key} type="monotone" dataKey={y.key} name={y.label} stroke={color(i, y.color)} fill={color(i, y.color)} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />)}
            </AreaChart>
          ) : chartType === 'pie' ? (
            <PieChart>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Pie data={data} dataKey={yk[0]?.key || 'value'} nameKey={xKey} cx="50%" cy="50%" innerRadius={42} outerRadius={78} paddingAngle={2} isAnimationActive={false}>
                {data.map((_, i) => <Cell key={i} fill={color(i)} />)}
              </Pie>
            </PieChart>
          ) : chartType === 'funnel' ? (
            <BarChart data={data} layout="vertical">
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey={xKey} tick={TICK} tickLine={false} axisLine={false} width={90} />
              <Tooltip />
              <Bar dataKey={yk[0]?.key || 'value'} name={yk[0]?.label || 'Count'} radius={[0, 6, 6, 0]} isAnimationActive={false}>
                {data.map((_, i) => <Cell key={i} fill={color(i)} />)}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={data}>
              {grid}
              <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={false} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {yk.map((y, i) => <Bar key={y.key} dataKey={y.key} name={y.label} fill={color(i, y.color)} radius={[6, 6, 0, 0]} isAnimationActive={false} />)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
