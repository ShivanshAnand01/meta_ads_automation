'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageHeader, Section, StatusPill, formatCurrency } from '@/components/ui/metric'
import { TextField, TextAreaField, ChipGroup, Field, SwitchRow } from '@/components/ui/field'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { MODEL_PRESETS } from '@/lib/ai/model-catalog'
import { Loader2, Save, Eye, EyeOff, Sparkles, Cpu, Key, Server, ShieldCheck } from 'lucide-react'

/**
 * Settings: the AI brain and the money guardrails.
 *
 * Two things that are both "settings" but matter differently. The brain is
 * set once. The caps are the thing the owner will come back to — they are
 * enforced in code (budget-guard.ts), so the page says so, and shows the
 * same numbers the server checks.
 */

const PROVIDERS = [
  { value: 'anthropic', name: 'Claude (Anthropic)', icon: Sparkles, blurb: 'Strongest at Indian-language copy and reasoning. Recommended.', needsKey: true, needsBase: false, defaultModel: 'claude-sonnet-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { value: 'openai', name: 'OpenAI', icon: Key, blurb: 'Good multilingual support. Also unlocks image generation.', needsKey: true, needsBase: false, defaultModel: 'gpt-5.4-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  { value: 'groq', name: 'Groq', icon: Server, blurb: 'Very fast, free tier. Weaker Devanagari.', needsKey: true, needsBase: false, defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  { value: 'ollama', name: 'Ollama (local)', icon: Cpu, blurb: 'Runs on your own machine. No key. Not reachable from the hosted app.', needsKey: false, needsBase: true, defaultModel: 'llama3', keyUrl: 'https://ollama.com' },
] as const

interface AiSettings { configured: boolean; provider?: string; model?: string; baseUrl?: string | null; hasApiKey?: boolean; hasEmbeddingKey?: boolean }
interface Strategy { targetRoas: number; targetCpa: number | null; monthlyBudget: number | null; dailyBudgetCap: number | null; focus: string | null; autoOptimize: boolean }

export default function SettingsPage() {
  const [ai, setAi] = useState<AiSettings | null>(null)
  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [currency, setCurrency] = useState('INR')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/ai').then((r) => r.json()),
      fetch('/api/strategy').then((r) => r.json()),
      fetch('/api/business-profile').then((r) => r.json()).catch(() => null),
    ]).then(([a, s, p]) => {
      setAi(a); setStrategy(s.strategy); if (p?.profile?.currency) setCurrency(p.profile.currency)
    }).catch(() => toast.error('Could not load settings')).finally(() => setLoading(false))
  }, [])

  if (loading || !ai || !strategy) return <PageSkeleton rows={2} />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="The AI that writes and the limits it cannot cross."
        meta={
          <>
            {ai.configured ? <StatusPill tone="good">AI: {ai.provider} · {ai.model}</StatusPill> : <StatusPill tone="warning">AI not configured</StatusPill>}
            {strategy.dailyBudgetCap ? <StatusPill tone="good" icon={ShieldCheck}>Daily cap {formatCurrency(strategy.dailyBudgetCap, currency)}</StatusPill> : <StatusPill tone="critical">No daily cap</StatusPill>}
          </>
        }
      />

      <Tabs defaultValue={ai.configured ? 'caps' : 'brain'}>
        <TabsList>
          <TabsTrigger value="brain">AI brain</TabsTrigger>
          <TabsTrigger value="caps">Budget caps and targets</TabsTrigger>
        </TabsList>
        <TabsContent value="brain" className="pt-4"><BrainForm initial={ai} onSaved={setAi} /></TabsContent>
        <TabsContent value="caps" className="pt-4"><StrategyForm initial={strategy} currency={currency} onSaved={setStrategy} /></TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Language, market and audience live in the <Link href="/business" className="underline underline-offset-2">Business Profile</Link>. Your Meta app and token live in <Link href="/connect" className="underline underline-offset-2">Meta Connection</Link>.
      </p>
    </div>
  )
}

function BrainForm({ initial, onSaved }: { initial: AiSettings; onSaved: (a: AiSettings) => void }) {
  const [form, setForm] = useState({ provider: initial.provider || 'anthropic', model: initial.model || '', baseUrl: initial.baseUrl || '', apiKey: '', embeddingKey: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const p = PROVIDERS.find((x) => x.value === form.provider) ?? PROVIDERS[0]

  function pick(provider: string) {
    const np = PROVIDERS.find((x) => x.value === provider)!
    setForm((f) => ({ ...f, provider, model: f.provider === provider ? f.model : np.defaultModel, baseUrl: np.needsBase ? f.baseUrl || 'http://localhost:11434' : '' }))
  }

  async function save() {
    const errs: Record<string, string> = {}
    if (p.needsKey && !form.apiKey && !(initial.hasApiKey && initial.provider === form.provider)) errs.apiKey = 'An API key is required for this provider.'
    if (!form.model.trim()) errs.model = 'Enter a model name.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const res = await fetch('/api/settings/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: form.provider, model: form.model.trim(), baseUrl: form.baseUrl || undefined, apiKey: form.apiKey || undefined, embeddingKey: form.embeddingKey || undefined }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Save failed')
      onSaved({ configured: true, provider: j.provider, model: j.model, baseUrl: j.baseUrl, hasApiKey: j.hasApiKey, hasEmbeddingKey: j.hasEmbeddingKey })
      setForm((f) => ({ ...f, apiKey: '', embeddingKey: '' }))
      toast.success('AI brain saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(false) }
  }

  const keySaved = initial.hasApiKey && initial.provider === form.provider

  return (
    <Section title="AI provider" description="Writes the copy, plans campaigns and answers in the AI Manager.">
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Provider">
          {PROVIDERS.map((opt) => {
            const on = form.provider === opt.value
            const Icon = opt.icon
            return (
              <button key={opt.value} type="button" role="radio" aria-checked={on} onClick={() => pick(opt.value)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30'}`}>
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${on ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}><Icon aria-hidden="true" className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{opt.name}</p>
                  <p className="text-xs leading-snug text-muted-foreground">{opt.blurb}</p>
                </div>
              </button>
            )
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <TextField label="Model" required value={form.model} onChange={(v) => setForm({ ...form, model: v })} error={errors.model} placeholder={p.defaultModel}
              hint={MODEL_PRESETS[form.provider]?.find((m) => m.value === form.model)?.note ?? 'Any model ID your key can use. Pick a preset below or type one.'} />
            {(MODEL_PRESETS[form.provider]?.length ?? 0) > 0 && (
              <ChipGroup<string>
                size="sm"
                options={MODEL_PRESETS[form.provider].map((m) => ({ value: m.value, label: m.label, hint: m.note }))}
                value={form.model}
                onChange={(v) => { if (typeof v === 'string') setForm({ ...form, model: v }) }}
              />
            )}
          </div>
          {p.needsBase && <TextField label="Server address" type="url" inputMode="url" value={form.baseUrl} onChange={(v) => setForm({ ...form, baseUrl: v })} placeholder="http://localhost:11434" />}
          {p.needsKey && (
            <Field label="API key" required={!keySaved} error={errors.apiKey}
              hint={<>{keySaved ? 'A key is saved. Paste a new one only to replace it. ' : ''}Get one from <a className="underline underline-offset-2" href={p.keyUrl} target="_blank" rel="noopener noreferrer">{new URL(p.keyUrl).hostname}</a>.</>}
              trailing={<button type="button" onClick={() => setShow((s) => !s)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-pressed={show}>{show ? <EyeOff aria-hidden="true" className="h-3.5 w-3.5" /> : <Eye aria-hidden="true" className="h-3.5 w-3.5" />} {show ? 'Hide' : 'Show'}</button>}>
              {({ id, describedBy, invalid }) => (
                <input id={id} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={keySaved ? '•••••••••••• saved' : 'sk-…'} aria-describedby={describedBy} aria-invalid={invalid || undefined}
                  className="h-10 w-full rounded-lg border border-input bg-transparent px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/50 dark:bg-input/30" />
              )}
            </Field>
          )}
          {form.provider !== 'openai' && (
            <TextField label="OpenAI key for images and website memory" type={show ? 'text' : 'password'} autoComplete="off" value={form.embeddingKey} onChange={(v) => setForm({ ...form, embeddingKey: v })} placeholder={initial.hasEmbeddingKey ? '•••••••••••• saved' : 'sk-… (optional)'} hint="Optional. Without it, images use a free provider and the website knowledge base is text-only." />
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>{busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="mr-1.5 h-4 w-4" />} Save AI brain</Button>
        </div>
      </div>
    </Section>
  )
}

function StrategyForm({ initial, currency, onSaved }: { initial: Strategy; currency: string; onSaved: (s: Strategy) => void }) {
  const [form, setForm] = useState({
    dailyBudgetCap: initial.dailyBudgetCap?.toString() ?? '',
    monthlyBudget: initial.monthlyBudget?.toString() ?? '',
    targetRoas: initial.targetRoas?.toString() ?? '3',
    targetCpa: initial.targetCpa?.toString() ?? '',
    focus: initial.focus ?? '',
    autoOptimize: initial.autoOptimize,
  })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function save() {
    const errs: Record<string, string> = {}
    const daily = form.dailyBudgetCap ? Number(form.dailyBudgetCap) : null
    const monthly = form.monthlyBudget ? Number(form.monthlyBudget) : null
    if (daily != null && !(daily > 0)) errs.dailyBudgetCap = 'Enter a positive amount.'
    if (monthly != null && !(monthly > 0)) errs.monthlyBudget = 'Enter a positive amount.'
    if (daily != null && monthly != null && daily > monthly) errs.dailyBudgetCap = 'The daily cap cannot exceed the monthly cap.'
    if (!(Number(form.targetRoas) > 0)) errs.targetRoas = 'Enter a number above 0. 3 means 3 back for every 1 spent.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const res = await fetch('/api/strategy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyBudgetCap: daily, monthlyBudget: monthly, targetRoas: Number(form.targetRoas), targetCpa: form.targetCpa ? Number(form.targetCpa) : null, focus: form.focus || null, autoOptimize: form.autoOptimize }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Save failed')
      onSaved(j.strategy)
      toast.success('Caps and targets saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Section title="Spending caps" description="Enforced in code before any budget reaches Meta. The AI cannot talk its way past them.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField label={`Daily cap (${currency})`} inputMode="numeric" value={form.dailyBudgetCap} onChange={(v) => setForm({ ...form, dailyBudgetCap: v.replace(/[^\d]/g, '') })} error={errors.dailyBudgetCap} hint="The most all campaigns together may spend in one day." />
          <TextField label={`Monthly cap (${currency})`} inputMode="numeric" value={form.monthlyBudget} onChange={(v) => setForm({ ...form, monthlyBudget: v.replace(/[^\d]/g, '') })} error={errors.monthlyBudget} hint="Spending stops for the month when this is reached." />
        </div>
        {!form.dailyBudgetCap && <p className="mt-3 rounded-lg bg-[var(--status-critical)]/10 px-3 py-2 text-xs text-[var(--status-critical-ink)]">No daily cap is set. Any budget the AI proposes would be allowed through.</p>}
      </Section>

      <Section title="Targets" description="What 'good' means for this business. Used to judge campaigns and decide what to scale.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField label="Target ROAS" required inputMode="decimal" value={form.targetRoas} onChange={(v) => setForm({ ...form, targetRoas: v.replace(/[^\d.]/g, '') })} error={errors.targetRoas} hint="Revenue per rupee spent. 3 means ₹3 back for every ₹1." />
          <TextField label={`Target cost per result (${currency})`} inputMode="numeric" value={form.targetCpa} onChange={(v) => setForm({ ...form, targetCpa: v.replace(/[^\d]/g, '') })} hint="Optional. What one sale or lead is worth paying for." />
        </div>
        <div className="mt-4 space-y-4">
          <TextAreaField label="Focus for this period" rows={2} value={form.focus} onChange={(v) => setForm({ ...form, focus: v })} placeholder="Push the Diwali bundle; hold spend on the single ebooks." hint="A sentence the AI keeps in mind when it plans." />
          <Field label="Automation level">
            {() => (
              <ChipGroup
                size="sm"
                value={form.autoOptimize ? 'auto' : 'ask'}
                onChange={(v) => v && setForm({ ...form, autoOptimize: v === 'auto' })}
                options={[
                  { value: 'ask', label: 'Ask me before changing budgets', hint: 'Every budget or status change waits for your approval.' },
                  { value: 'auto', label: 'Adjust within the caps automatically', hint: 'Small changes inside the caps happen on their own; big ones still ask.' },
                ]}
              />
            )}
          </Field>
          <SwitchRow label="Auto-optimise" description={form.autoOptimize ? 'On. Routine changes inside the caps run without asking.' : 'Off. Everything that moves money asks first.'} control={<Switch checked={form.autoOptimize} onCheckedChange={(v) => setForm({ ...form, autoOptimize: v })} />} className="border-t border-border" />
        </div>
      </Section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>{busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="mr-1.5 h-4 w-4" />} Save caps and targets</Button>
      </div>
    </div>
  )
}
