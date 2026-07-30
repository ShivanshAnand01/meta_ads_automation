'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Plus, Loader2, Megaphone, Play, Pause, Trash2, TrendingUp, IndianRupee } from 'lucide-react'
import { motion } from 'framer-motion'

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
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    objective: 'OUTCOME_SALES',
    budget: 1000,
    budgetType: 'daily',
    startDate: '',
    endDate: '',
  })

  useEffect(() => {
    fetchCampaigns()
  }, [])

  async function fetchCampaigns() {
    try {
      const res = await fetch('/api/campaigns')
      const json = await res.json()
      setCampaigns(json.campaigns || [])
    } catch {
      toast.error('Failed to load campaigns')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!form.name) {
      toast.error('Campaign name is required')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
          endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        }),
      })
      if (res.ok) {
        toast.success('Campaign created!')
        fetchCampaigns()
        setShowCreate(false)
        setForm({ name: '', objective: 'OUTCOME_SALES', budget: 1000, budgetType: 'daily', startDate: '', endDate: '' })
      }
    } catch {
      toast.error('Failed to create campaign')
    } finally {
      setCreating(false)
    }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      toast.success(`Campaign ${status}`)
      fetchCampaigns()
    } catch {
      toast.error('Failed to update campaign')
    }
  }

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign?')) return
    try {
      await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      toast.success('Campaign deleted')
      fetchCampaigns()
    } catch {
      toast.error('Failed to delete')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-32 rounded bg-muted" />
          <div className="h-96 rounded bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">Campaigns</h1>
          <p className="text-muted-foreground">Create and manage your Meta Ads campaigns</p>
        </motion.div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger render={<Button className="gradient-bg animate-gradient shadow-lg card-3d"><Plus className="mr-2 h-4 w-4" />New Campaign</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Campaign</DialogTitle>
              <DialogDescription>Set up a new Meta Ads campaign</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Campaign Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ebook Sales Campaign" />
              </div>
              <div className="space-y-2">
                <Label>Objective</Label>
                <Select value={form.objective} onValueChange={(v) => { if (v) setForm({ ...form, objective: v }) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OUTCOME_AWARENESS">Brand Awareness</SelectItem>
                    <SelectItem value="OUTCOME_TRAFFIC">Traffic</SelectItem>
                    <SelectItem value="OUTCOME_ENGAGEMENT">Engagement</SelectItem>
                    <SelectItem value="OUTCOME_LEADS">Leads</SelectItem>
                    <SelectItem value="OUTCOME_SALES">Sales (Recommended)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Budget (₹)</Label>
                  <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Budget Type</Label>
                  <Select value={form.budgetType} onValueChange={(v) => { if (v) setForm({ ...form, budgetType: v }) }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily Budget</SelectItem>
                      <SelectItem value="lifetime">Lifetime Budget</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)} className="glass card-3d">Cancel</Button>
              <Button onClick={handleCreate} disabled={creating} className="gradient-bg animate-gradient shadow-lg card-3d">
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Campaign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass card-3d overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 to-purple-500" />
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div><p className="text-sm text-muted-foreground">Total Campaigns</p><p className="text-2xl font-bold">{campaigns.length}</p></div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 shadow-md">
                <Megaphone className="h-4 w-4 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass card-3d overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div><p className="text-sm text-muted-foreground">Active</p><p className="text-2xl font-bold">{campaigns.filter(c => c.status === 'ACTIVE').length}</p></div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 shadow-md">
                <Play className="h-4 w-4 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass card-3d overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 to-cyan-500" />
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div><p className="text-sm text-muted-foreground">Total Budget</p><p className="text-2xl font-bold">₹{campaigns.reduce((s, c) => s + c.budget, 0).toLocaleString('en-IN')}</p></div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 shadow-md">
                <IndianRupee className="h-4 w-4 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass card-3d overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div><p className="text-sm text-muted-foreground">Total Spent</p><p className="text-2xl font-bold">₹{campaigns.reduce((s, c) => s + c.totalSpend, 0).toLocaleString('en-IN')}</p></div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 shadow-md">
                <TrendingUp className="h-4 w-4 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass card-3d">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Objective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Impr.</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id} className="transition-colors hover:bg-accent/30">
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{campaign.name}</p>
                      {campaign.metaCampaignId && (
                        <p className="text-xs text-muted-foreground">Meta ID: {campaign.metaCampaignId}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{campaign.objective.replace('OUTCOME_', '')}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={campaign.status === 'ACTIVE' ? 'default' : campaign.status === 'PAUSED' ? 'secondary' : 'destructive'}>
                      {campaign.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">₹{campaign.budget.toLocaleString('en-IN')}/{campaign.budgetType === 'daily' ? 'day' : 'total'}</TableCell>
                  <TableCell className="text-right text-sm">₹{campaign.totalSpend.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right text-sm">{campaign.totalImpressions.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right text-sm">{campaign.totalClicks.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right text-sm">{campaign.totalConversions.toLocaleString('en-IN')}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {campaign.status === 'ACTIVE' ? (
                        <Button size="sm" variant="ghost" onClick={() => updateStatus(campaign.id, 'PAUSED')} className="h-8 w-8 p-0"><Pause className="h-3.5 w-3.5" /></Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => updateStatus(campaign.id, 'ACTIVE')} className="h-8 w-8 p-0"><Play className="h-3.5 w-3.5" /></Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => deleteCampaign(campaign.id)} className="h-8 w-8 p-0"><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {campaigns.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <p className="text-sm text-muted-foreground">No campaigns yet</p>
              <Button onClick={() => setShowCreate(true)} className="gradient-bg animate-gradient shadow-lg card-3d"><Plus className="mr-2 h-4 w-4" />Create Campaign</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
