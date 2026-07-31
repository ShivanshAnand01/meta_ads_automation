'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Plus, Loader2, CalendarClock, Trash2, Clock, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'

interface ScheduledJob {
  id: string
  type: string
  campaignId: string | null
  cronExpression: string
  status: string
  lastRunAt: string | null
  nextRunAt: string | null
  createdAt: string
}

interface Campaign {
  id: string
  name: string
}

const jobTypes: Record<string, { label: string; description: string }> = {
  morning_optimization: { label: 'Morning Optimization', description: 'Daily check-in: performance review, budget pacing, and recommended actions' },
  budget_pacing: { label: 'Budget Pacing', description: 'Hourly budget check to avoid overspend and flag under-performing campaigns' },
  anomaly_detection: { label: 'Anomaly Detection', description: 'Detect unusual performance shifts and alert you automatically' },
  weekly_report: { label: 'Weekly Report', description: 'Monday summary of top spenders, winners, losers, and next-week actions' },
  reflection: { label: 'Reflection & Learning', description: 'Review recent actions and update the manager memory / strategy' },
  custom: { label: 'Custom', description: 'Run a custom prompt on schedule' },
}

const cronPresets = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day at 9 AM', value: '0 9 * * *' },
  { label: 'Every day at 12 PM', value: '0 12 * * *' },
  { label: 'Every Monday at 9 AM', value: '0 9 * * 1' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
]

export default function SchedulePage() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    type: 'morning_optimization',
    campaignId: '',
    cronExpression: '0 9 * * *',
  })

  useEffect(() => {
    fetchJobs()
    fetchCampaigns()
  }, [])

  async function fetchJobs() {
    try {
      const res = await fetch('/api/schedule')
      const json = await res.json()
      setJobs(json.jobs || [])
    } catch {
      toast.error('Failed to load scheduled jobs')
    } finally {
      setLoading(false)
    }
  }

  async function fetchCampaigns() {
    try {
      const res = await fetch('/api/campaigns')
      const json = await res.json()
      setCampaigns(json.campaigns || [])
    } catch {}
  }

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        toast.success('Scheduled job created!')
        fetchJobs()
        setShowCreate(false)
      }
    } catch {
      toast.error('Failed to create scheduled job')
    } finally {
      setCreating(false)
    }
  }

  async function toggleJob(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active'
    try {
      await fetch(`/api/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      toast.success(`Job ${newStatus}`)
      fetchJobs()
    } catch {
      toast.error('Failed to toggle job')
    }
  }

  async function deleteJob(id: string) {
    if (!confirm('Delete this scheduled job?')) return
    try {
      await fetch(`/api/schedule/${id}`, { method: 'DELETE' })
      toast.success('Job deleted')
      fetchJobs()
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
          <h1 className="text-3xl font-bold tracking-tight gradient-text">Schedule</h1>
          <p className="text-muted-foreground">Automate your Meta Ads workflow with scheduled jobs</p>
        </motion.div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger render={<Button className="gradient-bg animate-gradient shadow-lg card-3d"><Plus className="mr-2 h-4 w-4" />New Schedule</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Scheduled Job</DialogTitle>
              <DialogDescription>Automate a recurring Meta Ads task</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Job Type</Label>
                <Select value={form.type} onValueChange={(v) => { if (v) setForm({ ...form, type: v }) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(jobTypes).map(([key, info]) => (
                      <SelectItem key={key} value={key}>{info.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{jobTypes[form.type]?.description}</p>
              </div>
              {form.type === 'custom' && (
                <div className="space-y-2">
                  <Label>Campaign</Label>
                  <Select value={form.campaignId} onValueChange={(v) => { if (v) setForm({ ...form, campaignId: v }) }}>
                    <SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Schedule</Label>
                <Select value={form.cronExpression} onValueChange={(v) => { if (v) setForm({ ...form, cronExpression: v }) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cronPresets.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Cron: {form.cronExpression}</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)} className="glass card-3d">Cancel</Button>
              <Button onClick={handleCreate} disabled={creating} className="gradient-bg animate-gradient shadow-lg card-3d">
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Schedule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="glass card-3d">
        <CardHeader>
          <CardTitle>Automated Jobs</CardTitle>
          <CardDescription>Manage your scheduled automation tasks</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Type</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id} className="transition-colors hover:bg-accent/30">
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{jobTypes[job.type]?.label || job.type}</p>
                      <p className="text-xs text-muted-foreground">{job.cronExpression}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {cronPresets.find(p => p.value === job.cronExpression)?.label || job.cronExpression}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={job.status === 'active' ? 'default' : 'secondary'}>
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'Never'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Switch
                        checked={job.status === 'active'}
                        onCheckedChange={() => toggleJob(job.id, job.status)}
                      />
                      <Button size="sm" variant="ghost" onClick={() => deleteJob(job.id)} className="h-8 w-8 p-0">
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {jobs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CalendarClock className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No scheduled jobs yet</p>
              <Button onClick={() => setShowCreate(true)} className="gradient-bg animate-gradient shadow-lg card-3d"><Plus className="mr-2 h-4 w-4" />Create Schedule</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass card-3d">
        <CardHeader>
          <CardTitle>How Automation Works</CardTitle>
          <CardDescription>Your AI brain automates these tasks on schedule</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(jobTypes).map(([key, info]) => (
            <div key={key} className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/30">
              <div className="mt-0.5">
                {key === 'morning_optimization' && <CalendarClock className="h-4 w-4 text-blue-500" />}
                {key === 'budget_pacing' && <Clock className="h-4 w-4 text-green-500" />}
                {key === 'anomaly_detection' && <XCircle className="h-4 w-4 text-orange-500" />}
                {key === 'weekly_report' && <CheckCircle2 className="h-4 w-4 text-purple-500" />}
                {key === 'reflection' && <RefreshCw className="h-4 w-4 text-cyan-500" />}
                {key === 'custom' && <CalendarClock className="h-4 w-4 text-red-500" />}
              </div>
              <div>
                <p className="text-sm font-medium">{info.label}</p>
                <p className="text-xs text-muted-foreground">{info.description}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
