'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Sparkles, Plus, Loader2, CheckCircle2, XCircle, Eye, RefreshCw, Brain } from 'lucide-react'
import { motion } from 'framer-motion'
import type { CreativeReview, CreativeSuggestion } from '@/lib/ai/types'

interface CreativePayload extends Partial<CreativeReview>, Partial<CreativeSuggestion> {
  type?: 'review' | 'suggestion'
}

interface AdCreative {
  id: string
  title: string
  description: string
  imageUrl: string | null
  primaryText: string | null
  headline: string | null
  callToAction: string | null
  targeting: string | null
  expectedSpend: number | null
  expectedRoas: number | null
  actualSpend: number | null
  actualRoas: number | null
  impressions: number | null
  clicks: number | null
  conversions: number | null
  status: string
  reviewStatus: string
  reviewNotes: string | null
  language: string
  audience: string | null
  createdAt: string
  campaign?: { id: string; name: string } | null
}

export default function CreativesPage() {
  const [creatives, setCreatives] = useState<AdCreative[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Record<string, CreativePayload>>({})

  const [showGenerator, setShowGenerator] = useState(false)
  const [genForm, setGenForm] = useState({
    productType: 'Ebook',
    productName: '',
    productDescription: '',
    targetAudience: 'Maharashtrian audience in India (Marathi speakers)',
    budget: 5000,
    count: 3,
  })

  useEffect(() => {
    fetchCreatives()
  }, [])

  async function fetchCreatives() {
    try {
      const res = await fetch('/api/creatives')
      const json = await res.json()
      setCreatives(json.creatives || [])
    } catch {
      toast.error('Failed to load creatives')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate() {
    if (!genForm.productName || !genForm.productDescription) {
      toast.error('Product name and description are required')
      return
    }

    setGenerating(true)
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genForm),
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Generation failed')

      toast.success(`Generated ${json.suggestions?.length || 0} creative(s)!`)
      fetchCreatives()
      setShowGenerator(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleReview(id: string, status: 'verified' | 'not_verified') {
    try {
      const res = await fetch(`/api/creatives/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: status }),
      })
      if (res.ok) {
        toast.success(status === 'verified' ? 'Creative approved!' : 'Creative marked for revision')
        fetchCreatives()
      }
    } catch {
      toast.error('Failed to update review status')
    }
  }

  async function handleAiReview(creative: AdCreative) {
    setReviewing(creative.id)
    try {
      const res = await fetch('/api/ai/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creativeId: creative.id }),
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Review failed')

      setSuggestions({ ...suggestions, [creative.id]: json.review })
      toast.success('AI review complete!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI review failed')
    } finally {
      setReviewing(null)
    }
  }

  async function handleImprove(creative: AdCreative) {
    try {
      const res = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creativeId: creative.id }),
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Suggestion failed')

      toast.success('AI suggestions generated! Check the details.')
      setSuggestions({ ...suggestions, [creative.id]: { ...json.suggestion, type: 'suggestion' } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to get suggestions')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-96 rounded bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">Ad Creatives</h1>
          <p className="text-muted-foreground">Manage and review your Marathi ad creatives</p>
        </motion.div>
        <Dialog open={showGenerator} onOpenChange={setShowGenerator}>
          <DialogTrigger render={<Button className="gradient-bg animate-gradient shadow-lg card-3d"><Sparkles className="mr-2 h-4 w-4" />AI Generate</Button>} />
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Generate Ad Creatives with AI</DialogTitle>
              <DialogDescription>
                The AI brain will create Marathi ad creatives optimized for your Maharashtrian audience
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Product Type</Label>
                  <Input
                    value={genForm.productType}
                    onChange={(e) => setGenForm({ ...genForm, productType: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Product Name</Label>
                  <Input
                    placeholder="e.g., Marathi Sales Mastery Ebook"
                    value={genForm.productName}
                    onChange={(e) => setGenForm({ ...genForm, productName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Product Description</Label>
                <Textarea
                  placeholder="Describe your ebook or product..."
                  rows={3}
                  value={genForm.productDescription}
                  onChange={(e) => setGenForm({ ...genForm, productDescription: e.target.value })}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Target Audience</Label>
                  <Input
                    value={genForm.targetAudience}
                    onChange={(e) => setGenForm({ ...genForm, targetAudience: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Budget (₹)</Label>
                  <Input
                    type="number"
                    value={genForm.budget}
                    onChange={(e) => setGenForm({ ...genForm, budget: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Number of Variations</Label>
                <Select
                  value={String(genForm.count)}
                  onValueChange={(v) => setGenForm({ ...genForm, count: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 creative</SelectItem>
                    <SelectItem value="3">3 creatives (Recommended)</SelectItem>
                    <SelectItem value="5">5 creatives</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowGenerator(false)} className="glass card-3d">Cancel</Button>
              <Button onClick={handleGenerate} disabled={generating} className="gradient-bg animate-gradient shadow-lg card-3d">
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({creatives.length})</TabsTrigger>
          <TabsTrigger value="pending">
            Pending Review ({creatives.filter(c => c.reviewStatus === 'pending').length})
          </TabsTrigger>
          <TabsTrigger value="verified">
            Approved ({creatives.filter(c => c.reviewStatus === 'verified').length})
          </TabsTrigger>
          <TabsTrigger value="not_verified">
            Rejected ({creatives.filter(c => c.reviewStatus === 'not_verified').length})
          </TabsTrigger>
        </TabsList>

        {['all', 'pending', 'verified', 'not_verified'].map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <Card className="glass card-3d">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Image</TableHead>
                      <TableHead>Title & Description</TableHead>
                      <TableHead>Primary Text (Marathi)</TableHead>
                      <TableHead className="text-right">Expected Spend</TableHead>
                      <TableHead className="text-right">Expected ROAS</TableHead>
                      <TableHead>Actual Perf.</TableHead>
                      <TableHead>Review</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creatives
                      .filter((c) => {
                        if (tab === 'all') return true
                        return c.reviewStatus === tab
                      })
                      .map((creative) => (
                        <TableRow key={creative.id} className="transition-colors hover:bg-accent/30">
                          <TableCell>
                            {creative.imageUrl ? (
                              <Image
                                src={creative.imageUrl}
                                alt={creative.title}
                                width={48}
                                height={48}
                                className="h-12 w-12 rounded object-cover"
                              />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded bg-muted">
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{creative.title}</p>
                              <p className="text-xs text-muted-foreground line-clamp-2 max-w-xs">
                                {creative.description}
                              </p>
                              <div className="flex gap-1">
                                <Badge variant="outline" className="text-xs">
                                  {creative.language}
                                </Badge>
                                {creative.audience && (
                                  <Badge variant="outline" className="text-xs">
                                    {creative.audience}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <p className="text-sm line-clamp-3 font-mono marathi" style={{ fontFamily: 'Noto Sans Devanagari, sans-serif' }}>
                              {creative.primaryText || 'N/A'}
                            </p>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-sm font-medium">
                              ₹{creative.expectedSpend || 0}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-sm font-medium">
                              {creative.expectedRoas || 0}x
                            </span>
                          </TableCell>
                          <TableCell>
                            {creative.actualSpend ? (
                              <div className="space-y-1 text-xs">
                                <p>Spend: ₹{creative.actualSpend}</p>
                                <p>Impr: {creative.impressions || 0}</p>
                                <p>Clicks: {creative.clicks || 0}</p>
                                <p>Conv: {creative.conversions || 0}</p>
                                <p>ROAS: {creative.actualRoas || 0}x</p>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not published</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                creative.reviewStatus === 'verified' ? 'default' :
                                creative.reviewStatus === 'not_verified' ? 'destructive' : 'secondary'
                              }
                            >
                              {creative.reviewStatus.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleReview(creative.id, 'verified')}
                                  className="h-7 w-7 p-0"
                                  title="Approve"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleReview(creative.id, 'not_verified')}
                                  className="h-7 w-7 p-0"
                                  title="Reject"
                                >
                                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                                </Button>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleAiReview(creative)}
                                disabled={reviewing === creative.id}
                                className="h-7 text-xs"
                              >
                                {reviewing === creative.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <>
                                    <Brain className="mr-1 h-3 w-3" />
                                    AI Review
                                  </>
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleImprove(creative)}
                                className="h-7 text-xs"
                              >
                                <RefreshCw className="mr-1 h-3 w-3" />
                                Improve
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>

                {creatives.filter((c) => {
                  if (tab === 'all') return true
                  return c.reviewStatus === tab
                }).length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <p className="text-sm text-muted-foreground">No creatives found</p>
                    <Button onClick={() => setShowGenerator(true)} className="gradient-bg animate-gradient shadow-lg card-3d">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Creatives with AI
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {Object.keys(suggestions).length > 0 && (
        <Card className="glass card-3d">
          <CardHeader>
            <CardTitle>AI Analysis & Suggestions</CardTitle>
            <CardDescription>AI-generated insights for your creatives</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(suggestions).map(([creativeId, suggestion]) => {
              const creative = creatives.find((c) => c.id === creativeId)
              return (
                <div key={creativeId} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">{creative?.title || 'Creative'}</h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const next = { ...suggestions }
                        delete next[creativeId]
                        setSuggestions(next)
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                  {'score' in suggestion && typeof suggestion.score === 'number' && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Score:</span>
                        <Badge variant={suggestion.score >= 70 ? 'default' : suggestion.score >= 40 ? 'secondary' : 'destructive'}>
                          {suggestion.score}/100
                        </Badge>
                      </div>
                      {Array.isArray(suggestion.strengths) && suggestion.strengths.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-green-600 mb-1">Strengths:</p>
                          <ul className="text-xs space-y-1">
                            {suggestion.strengths.map((s: string, i: number) => (
                              <li key={i} className="text-muted-foreground">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {Array.isArray(suggestion.weaknesses) && suggestion.weaknesses.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-red-600 mb-1">Weaknesses:</p>
                          <ul className="text-xs space-y-1">
                            {suggestion.weaknesses.map((w: string, i: number) => (
                              <li key={i} className="text-muted-foreground">• {w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {Array.isArray(suggestion.suggestions) && suggestion.suggestions.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-blue-600 mb-1">Suggestions:</p>
                          <ul className="text-xs space-y-1">
                            {suggestion.suggestions.map((s: string, i: number) => (
                              <li key={i} className="text-muted-foreground">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {Array.isArray(suggestion.recommendedChanges) && suggestion.recommendedChanges.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-purple-600 mb-1">Recommended Changes:</p>
                          <ul className="text-xs space-y-1">
                            {suggestion.recommendedChanges.map((c: string, i: number) => (
                              <li key={i} className="text-muted-foreground">• {c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                  {'primaryText' in suggestion && (
                    <>
                      <div className="space-y-2">
                        <div>
                          <span className="text-xs font-medium">Improved Marathi Ad Copy:</span>
                          <p className="text-sm mt-1 p-2 rounded bg-muted marathi" style={{ fontFamily: 'Noto Sans Devanagari, sans-serif' }}>
                            {suggestion.primaryText}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-medium">Improved Headline:</span>
                          <p className="text-sm mt-1 p-2 rounded bg-muted marathi" style={{ fontFamily: 'Noto Sans Devanagari, sans-serif' }}>
                            {suggestion.headline}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-medium">Reasoning:</span>
                          <p className="text-xs mt-1 text-muted-foreground">{suggestion.reasoning}</p>
                        </div>
                        <Button
                          size="sm"
                          className="gradient-bg animate-gradient shadow-lg card-3d"
                          onClick={async () => {
                            try {
                              await fetch(`/api/creatives/${creativeId}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  primaryText: suggestion.primaryText,
                                  headline: suggestion.headline,
                                  callToAction: suggestion.callToAction,
                                  targeting: suggestion.targeting,
                                  expectedRoas: suggestion.expectedRoas,
                                }),
                              })
                              toast.success('Creative updated with AI suggestions!')
                              fetchCreatives()
                            } catch {
                              toast.error('Failed to update creative')
                            }
                          }}
                        >
                          Apply Improvements
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <Card className="glass card-3d">
        <CardHeader>
          <CardTitle>Manual Creative Builder</CardTitle>
          <CardDescription>Create an ad creative on your own without AI</CardDescription>
        </CardHeader>
        <CardContent>
          <ManualCreativeBuilder onCreated={fetchCreatives} />
        </CardContent>
      </Card>
    </div>
  )
}

function ManualCreativeBuilder({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    primaryText: '',
    headline: '',
    callToAction: 'LEARN_MORE',
    targeting: '',
    expectedSpend: 1000,
    expectedRoas: 2.0,
    language: 'marathi',
    audience: 'Maharashtra',
    imageUrl: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!form.title || !form.description) {
      toast.error('Title and description are required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        toast.success('Creative created!')
        onCreated()
        setForm({
          title: '', description: '', primaryText: '', headline: '',
          callToAction: 'LEARN_MORE', targeting: '', expectedSpend: 1000,
          expectedRoas: 2.0, language: 'marathi', audience: 'Maharashtra', imageUrl: '',
        })
      }
    } catch {
      toast.error('Failed to create creative')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Creative name" />
        </div>
        <div className="space-y-2">
          <Label>Image URL</Label>
          <Input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Primary Text (Marathi)</Label>
          <Textarea value={form.primaryText} onChange={(e) => setForm({ ...form, primaryText: e.target.value })} rows={3} className="marathi" style={{ fontFamily: 'Noto Sans Devanagari, sans-serif' }} />
        </div>
        <div className="space-y-2">
          <Label>Headline (Marathi)</Label>
          <Input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} className="marathi" style={{ fontFamily: 'Noto Sans Devanagari, sans-serif' }} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>Call to Action</Label>
          <Select value={form.callToAction} onValueChange={(v) => { if (v) setForm({ ...form, callToAction: v }) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="LEARN_MORE">Learn More</SelectItem>
              <SelectItem value="SHOP_NOW">Shop Now</SelectItem>
              <SelectItem value="SIGN_UP">Sign Up</SelectItem>
              <SelectItem value="DOWNLOAD">Download</SelectItem>
              <SelectItem value="BUY_NOW">Buy Now</SelectItem>
              <SelectItem value="SUBSCRIBE">Subscribe</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Expected Spend (₹)</Label>
          <Input type="number" value={form.expectedSpend} onChange={(e) => setForm({ ...form, expectedSpend: Number(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label>Expected ROAS</Label>
          <Input type="number" step="0.1" value={form.expectedRoas} onChange={(e) => setForm({ ...form, expectedRoas: Number(e.target.value) })} />
        </div>
      </div>
      <Button onClick={handleSave} disabled={saving} className="gradient-bg animate-gradient shadow-lg card-3d">
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
        Create Creative
      </Button>
    </div>
  )
}
