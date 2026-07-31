'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Eye, MousePointerClick,
  IndianRupee, Target, Sparkles, AlertCircle,
  ArrowUpRight, Activity
} from 'lucide-react'
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, BarChart, Bar,
} from 'recharts'

interface DashboardData {
  connected: boolean
  adAccount?: { name: string; accountId: string; currency: string; status: string }
  stats?: {
    totalSpend: number; totalRevenue: number; totalImpressions: number; totalClicks: number
    totalConversions: number; ctr: number; cpc: number; roas: number
  }
  performanceData?: { date: string; spend: number; impressions: number; clicks: number; revenue: number }[]
  recentCreatives?: {
    id: string; title: string; status: string; reviewStatus: string
    expectedSpend: number; expectedRoas: number; createdAt: string
  }[]
  aiConfigured: boolean
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } }
}
const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 260, damping: 24 } }
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/dashboard')
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to load dashboard')
        setData(json)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load dashboard')
        setData({ connected: false, aiConfigured: false })
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    )
  }

  if (!data?.connected) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center min-h-[70vh] gap-6"
      >
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="flex h-20 w-20 items-center justify-center rounded-3xl gradient-bg animate-gradient shadow-2xl glow-md"
        >
          <Sparkles className="h-10 w-10 text-white" />
        </motion.div>
        <div className="text-center space-y-3">
          <h2 className="text-3xl font-bold gradient-text">Welcome to AdManager</h2>
          <p className="text-muted-foreground max-w-md">
            Connect your Meta Ads account to start managing campaigns, generating AI creatives, and tracking performance — all in one place.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/connect">
            <Button size="lg" className="gradient-bg animate-gradient shadow-lg hover:shadow-xl transition-shadow">
              <Sparkles className="mr-2 h-4 w-4" />
              Connect Meta Account
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="outline" size="lg" className="glass">
              Configure AI Brain
            </Button>
          </Link>
        </div>
      </motion.div>
    )
  }

  const stats = data.stats || { totalSpend: 0, totalRevenue: 0, totalImpressions: 0, totalClicks: 0, totalConversions: 0, ctr: 0, cpc: 0, roas: 0 }

  const statCards = [
    { label: 'Total Spend', value: `₹${stats.totalSpend.toLocaleString('en-IN')}`, sub: 'All-time ad spend', icon: IndianRupee, gradient: 'from-violet-500 to-purple-500' },
    { label: 'Total Revenue', value: `₹${stats.totalRevenue.toLocaleString('en-IN')}`, sub: 'Purchase / conversion value', icon: Activity, gradient: 'from-fuchsia-500 to-pink-500' },
    { label: 'Impressions', value: stats.totalImpressions.toLocaleString('en-IN'), sub: 'Total ad views', icon: Eye, gradient: 'from-blue-500 to-cyan-500' },
    { label: 'Clicks', value: stats.totalClicks.toLocaleString('en-IN'), sub: `CTR: ${stats.ctr.toFixed(2)}%`, icon: MousePointerClick, gradient: 'from-emerald-500 to-teal-500' },
    { label: 'ROAS', value: `${stats.roas.toFixed(2)}x`, sub: 'Return on ad spend', icon: stats.roas >= 1 ? TrendingUp : TrendingDown, gradient: stats.roas >= 1 ? 'from-amber-500 to-orange-500' : 'from-red-500 to-rose-500' },
  ]

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">Dashboard</h1>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            {data.adAccount?.name || 'Ad Account'} • {data.adAccount?.accountId}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/creatives">
            <Button variant="outline" className="glass card-3d">
              <Sparkles className="mr-2 h-4 w-4" />
              AI Creative
            </Button>
          </Link>
          <Link href="/campaigns">
            <Button className="gradient-bg animate-gradient shadow-lg card-3d">
              <Target className="mr-2 h-4 w-4" />
              New Campaign
            </Button>
          </Link>
        </div>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
        >
          {error}
        </motion.div>
      )}

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-5"
      >
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <motion.div key={stat.label} variants={item}>
              <Card className="glass card-3d overflow-hidden">
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${stat.gradient}`} />
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${stat.gradient} shadow-md`}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
          <Card className="glass card-3d">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <div>
                  <CardTitle>Ad Spend & Performance</CardTitle>
                  <CardDescription>Last 30 days overview</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.performanceData || []}>
                  <defs>
                    <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0.02 250 / 0.1)" />
                  <XAxis dataKey="date" fontSize={11} stroke="oklch(0.5 0.02 250)" />
                  <YAxis fontSize={11} stroke="oklch(0.5 0.02 250)" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'oklch(0.15 0.02 250 / 0.9)',
                      border: '1px solid oklch(0.3 0.02 250)',
                      borderRadius: '12px',
                      backdropFilter: 'blur(8px)',
                    }}
                    labelStyle={{ color: 'oklch(0.97 0.005 250)' }}
                  />
                  <Area type="monotone" dataKey="spend" stroke="#8b5cf6" strokeWidth={2} fill="url(#spendGradient)" name="Spend (₹)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
          <Card className="glass card-3d">
            <CardHeader>
              <div className="flex items-center gap-2">
                <MousePointerClick className="h-4 w-4 text-primary" />
                <div>
                  <CardTitle>Clicks vs Impressions</CardTitle>
                  <CardDescription>Daily breakdown</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.performanceData || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0.02 250 / 0.1)" />
                  <XAxis dataKey="date" fontSize={11} stroke="oklch(0.5 0.02 250)" />
                  <YAxis fontSize={11} stroke="oklch(0.5 0.02 250)" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'oklch(0.15 0.02 250 / 0.9)',
                      border: '1px solid oklch(0.3 0.02 250)',
                      borderRadius: '12px',
                      backdropFilter: 'blur(8px)',
                    }}
                    labelStyle={{ color: 'oklch(0.97 0.005 250)' }}
                    cursor={{ fill: 'oklch(0.52 0.22 264 / 0.05)' }}
                  />
                  <Bar dataKey="impressions" fill="#06b6d4" name="Impressions" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="clicks" fill="#8b5cf6" name="Clicks" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card className="glass card-3d">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <div>
                  <CardTitle>Recent Ad Creatives</CardTitle>
                  <CardDescription>Latest creatives awaiting your review</CardDescription>
                </div>
              </div>
              <Link href="/creatives">
                <Button variant="ghost" size="sm" className="text-primary">
                  View All
                  <ArrowUpRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {data.recentCreatives && data.recentCreatives.length > 0 ? (
              <div className="space-y-3">
                {data.recentCreatives.slice(0, 5).map((creative, i) => (
                  <motion.div
                    key={creative.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + i * 0.05 }}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-card/50 p-3 hover:bg-accent/30 transition-colors"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{creative.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(creative.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-sm">
                        <p className="font-semibold">₹{creative.expectedSpend || 0}</p>
                        <p className="text-xs text-muted-foreground">ROAS: {creative.expectedRoas || 0}x</p>
                      </div>
                      <Badge
                        variant={creative.reviewStatus === 'verified' ? 'default' : creative.reviewStatus === 'not_verified' ? 'destructive' : 'secondary'}
                        className={creative.reviewStatus === 'verified' ? 'bg-emerald-500/80' : ''}
                      >
                        {creative.reviewStatus.replace('_', ' ')}
                      </Badge>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 shadow-lg">
                  <Sparkles className="h-6 w-6 text-white" />
                </div>
                <p className="text-sm text-muted-foreground">No creatives yet</p>
                <Link href="/creatives">
                  <Button className="gradient-bg animate-gradient shadow-lg">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate Your First Ad Creative
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {!data.aiConfigured && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
          <Card className="glass border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">AI Brain not configured</p>
                  <p className="text-xs text-muted-foreground">
                    Set up an AI provider to generate ad creatives and use the AI Manager
                  </p>
                </div>
              </div>
              <Link href="/settings">
                <Button variant="outline" className="glass card-3d">Configure</Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  )
}
