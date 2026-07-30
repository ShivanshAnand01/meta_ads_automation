'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Wallet, IndianRupee, TrendingUp, AlertCircle, Loader2, Plus, ArrowUpRight } from 'lucide-react'
import { motion } from 'framer-motion'

interface BillingData {
  connected: boolean
  adAccount?: {
    name: string
    currency: string
  }
  balance?: string
  spendCap?: string
  amountSpent?: string
  billingHistory?: {
    amount: string
    currency: string
    billing_date: string
    status: string
    invoice_url: string
  }[]
  campaignSpend?: {
    id: string
    name: string
    budget: number
    totalSpend: number
    budgetType: string
  }[]
}

export default function BudgetPage() {
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [addingFunds, setAddingFunds] = useState(false)
  const [fundAmount, setFundAmount] = useState('')

  useEffect(() => {
    fetchBilling()
  }, [])

  async function fetchBilling() {
    try {
      const res = await fetch('/api/meta/billing')
      const json = await res.json()
      setData(json)
    } catch {
      setData({ connected: false })
    } finally {
      setLoading(false)
    }
  }

  async function handleAddFunds() {
    if (!fundAmount) {
      toast.error('Enter an amount')
      return
    }
    setAddingFunds(true)
    try {
      const res = await fetch('/api/meta/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_funds', amount: Number(fundAmount) }),
      })
      if (res.ok) {
        toast.success(`Added ₹${fundAmount} to your ad account (simulated)`)
        setFundAmount('')
        fetchBilling()
      }
    } catch {
      toast.error('Failed to add funds')
    } finally {
      setAddingFunds(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!data?.connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Wallet className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Connect Your Meta Account</h2>
          <p className="text-muted-foreground max-w-md">
            Connect your Meta Ads account to view billing information, manage budgets, and add funds.
          </p>
        </div>
        <Button onClick={() => window.location.href = '/connect'} className="gradient-bg animate-gradient shadow-lg card-3d">
          Connect Meta Account
        </Button>
      </div>
    )
  }

  const balance = Number(data.balance || 0)
  const spendCap = Number(data.spendCap || 0)
  const amountSpent = Number(data.amountSpent || 0)
  const budgetUsed = spendCap > 0 ? (amountSpent / spendCap) * 100 : 0

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold tracking-tight gradient-text">Budget & Bills</h1>
        <p className="text-muted-foreground">Manage your ad spend and billing</p>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass card-3d overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 to-purple-500" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Account Balance</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 shadow-md">
              <Wallet className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{balance.toLocaleString('en-IN')}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {balance > 0 ? 'Available for spending' : 'No balance remaining'}
            </p>
          </CardContent>
        </Card>

        <Card className="glass card-3d overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 to-cyan-500" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 shadow-md">
              <IndianRupee className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{amountSpent.toLocaleString('en-IN')}</div>
            <p className="text-xs text-muted-foreground mt-1">
              All-time spend across all campaigns
            </p>
          </CardContent>
        </Card>

        <Card className="glass card-3d overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Spend Limit</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 shadow-md">
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{spendCap.toLocaleString('en-IN')}</div>
            <div className="mt-2">
              <Progress value={budgetUsed} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {budgetUsed.toFixed(1)}% of limit used
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass card-3d">
        <CardHeader>
          <CardTitle>Add Funds</CardTitle>
          <CardDescription>Add money to your ad account balance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="fundAmount">Amount (₹)</Label>
              <Input
                id="fundAmount"
                type="number"
                placeholder="Enter amount"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleAddFunds} disabled={addingFunds} className="gradient-bg animate-gradient shadow-lg card-3d">
                {addingFunds ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Funds
              </Button>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {[1000, 5000, 10000, 25000].map((amt) => (
              <Button
                key={amt}
                variant="outline"
                size="sm"
                onClick={() => setFundAmount(String(amt))}
                className="glass card-3d"
              >
                ₹{amt.toLocaleString('en-IN')}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Note: Funds are managed through Meta&apos;s billing system. This interface will redirect to Meta&apos;s payment portal.
          </p>
        </CardContent>
      </Card>

      {data.campaignSpend && data.campaignSpend.length > 0 && (
        <Card className="glass card-3d">
          <CardHeader>
            <CardTitle>Campaign Budget Breakdown</CardTitle>
            <CardDescription>How your budget is allocated across campaigns</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Usage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.campaignSpend.map((campaign) => {
                  const remaining = campaign.budget - campaign.totalSpend
                  const usage = campaign.budget > 0 ? (campaign.totalSpend / campaign.budget) * 100 : 0
                  return (
                    <TableRow key={campaign.id}>
                      <TableCell className="text-sm font-medium">{campaign.name}</TableCell>
                      <TableCell className="text-right text-sm">₹{campaign.budget.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-right text-sm">₹{campaign.totalSpend.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-right text-sm">
                        <span className={remaining < 0 ? 'text-red-500' : ''}>
                          ₹{remaining.toLocaleString('en-IN')}
                        </span>
                      </TableCell>
                      <TableCell className="w-32">
                        <div className="flex items-center gap-2">
                          <Progress value={Math.min(usage, 100)} className="h-2" />
                          <span className="text-xs text-muted-foreground">{usage.toFixed(0)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="glass card-3d">
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
          <CardDescription>Your recent billing transactions</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.billingHistory && data.billingHistory.length > 0 ? (
                data.billingHistory.map((bill, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{new Date(bill.billing_date).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right text-sm font-medium">₹{bill.amount}</TableCell>
                    <TableCell>
                      <Badge variant={bill.status === 'PAID' ? 'default' : 'secondary'}>
                        {bill.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {bill.invoice_url ? (
                        <Button size="sm" variant="ghost" onClick={() => window.open(bill.invoice_url, '_blank')}>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                    No billing history available. Billing data will appear once you start running ads.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
