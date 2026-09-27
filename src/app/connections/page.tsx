'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader, StatusPill, type StatusTone } from '@/components/ui/metric'
import { Field, TextField, ChipGroup } from '@/components/ui/field'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  PROVIDERS, CATEGORY_LABELS, CUSTOM_MCP, getProvider,
  type IntegrationCategory, type IntegrationMode, type IntegrationView, type ProviderDef,
} from '@/lib/integrations/catalog'
import {
  Search, Clapperboard, AudioLines, Plug, ExternalLink, Eye, EyeOff, Loader2,
  RefreshCw, Trash2, CheckCircle2, XCircle, KeyRound, Network, ShieldCheck, type LucideIcon,
} from 'lucide-react'

/**
 * Connections: optional third-party tools that make the agents stronger.
 *
 * Nothing here is required. OpenAI (set in Settings) already covers copy and
 * images; these add web research, other image/video models, voice, and any
 * MCP server. Every key is tested before it is saved and stored in Vault; the
 * page only ever sees the last four characters.
 */

const CATEGORY_ICON: Record<IntegrationCategory, LucideIcon> = {
  research: Search,
  media: Clapperboard,
  voice: AudioLines,
  custom: Plug,
}

const CATEGORY_ORDER: IntegrationCategory[] = ['research', 'media', 'voice']

function statusOf(i: IntegrationView | undefined): { tone: StatusTone; label: string } {
  if (!i) return { tone: 'neutral', label: 'Not connected' }
  if (i.status === 'connected') return { tone: 'good', label: 'Connected' }
  if (i.status === 'error') return { tone: 'critical', label: 'Needs attention' }
  return { tone: 'warning', label: 'Not tested' }
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  return `${Math.round(hrs / 24)} d ago`
}

// ── Connect dialog ────────────────────────────────────────────────────────

type Target = { kind: 'provider'; provider: ProviderDef } | { kind: 'custom' }

function ConnectDialog({
  target, existing, onClose, onConnected,
}: {
  target: Target | null
  existing?: IntegrationView
  onClose: () => void
  onConnected: (i: IntegrationView) => void
}) {
  const provider = target?.kind === 'provider' ? target.provider : null
  const modes: IntegrationMode[] = provider ? [...(provider.api ? ['api_key' as const] : []), ...(provider.mcp ? ['mcp' as const] : [])] : ['mcp']
  const [mode, setMode] = useState<IntegrationMode>(existing?.mode ?? modes[0] ?? 'api_key')
  const [secret, setSecret] = useState('')
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [headerName, setHeaderName] = useState('Authorization')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = target !== null
  const title = provider ? `Connect ${provider.name}` : 'Connect a custom MCP server'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          provider
            ? { provider: provider.id, mode, secret }
            : { provider: 'custom-mcp', mode: 'mcp', name, mcpUrl: url, headerName, secret },
        ),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.message || json.error || 'Connection failed.')
        return
      }
      toast.success(json.message)
      setSecret('')
      onConnected(json.integration)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {provider
                ? <>We test the key before saving it. It is stored encrypted and never shown again.</>
                : <>Any tool that publishes an MCP server URL. The agent can list its tools and, with your approval, run them.</>}
            </DialogDescription>
          </DialogHeader>

          {provider && modes.length > 1 && (
            <Field label="Connect with">
              {() => (
                <ChipGroup<IntegrationMode>
                  options={[
                    { value: 'api_key', label: <><KeyRound aria-hidden="true" className="h-3.5 w-3.5" />API key</> },
                    { value: 'mcp', label: <><Network aria-hidden="true" className="h-3.5 w-3.5" />MCP server</> },
                  ]}
                  value={mode}
                  onChange={(v) => v && setMode(v as IntegrationMode)}
                />
              )}
            </Field>
          )}

          {provider && (
            <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {mode === 'mcp'
                ? <>The agent gets every tool {provider.name}&apos;s MCP server offers. We check the key, then list the tools.</>
                : <>{provider.api?.testNote}</>}
            </p>
          )}

          {!provider && (
            <>
              <TextField label="Name" required value={name} onChange={setName} placeholder="e.g. My CRM" hint="Shown to you and to the agent." />
              <TextField label="Server URL" required value={url} onChange={setUrl} type="url" inputMode="url" placeholder="https://example.com/mcp" hint="Must be a public https:// address." />
              <TextField label="Auth header name" value={headerName} onChange={setHeaderName} placeholder="Authorization" hint="Leave as Authorization for a bearer token. Some servers use x-api-key." />
            </>
          )}

          <Field
            label={provider ? `${provider.name} API key` : 'Token (optional)'}
            required={Boolean(provider)}
            error={error}
            hint={provider ? (
              <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline">
                Get a key from {provider.name}<ExternalLink aria-hidden="true" className="h-3 w-3" /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : 'Leave empty if the server needs no key.'}
          >
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <Input
                  id={id}
                  type={show ? 'text' : 'password'}
                  value={secret}
                  onChange={(e) => { setSecret(e.target.value); setError(null) }}
                  placeholder={provider?.keyHint || (existing?.keyPreview ? `Current key ends ${existing.keyPreview}` : '')}
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  className="h-10 pr-11 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide key' : 'Show key'}
                  aria-pressed={show}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {show ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                </button>
              </div>
            )}
          </Field>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || (provider ? !secret.trim() : !name.trim() || !url.trim())}>
              {busy && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
              {busy ? 'Testing…' : 'Test and connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Cards ─────────────────────────────────────────────────────────────────

function ConnectionCard({
  name, blurb, usedBy, integration, modes, onConnect, onRetest, onRemove, testing,
}: {
  name: string
  blurb: string
  usedBy: string[]
  integration?: IntegrationView
  modes: string
  onConnect: () => void
  onRetest: () => void
  onRemove: () => void
  testing: boolean
}) {
  const s = statusOf(integration)
  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-heading text-base font-semibold leading-tight">{name}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{blurb}</p>
        </div>
        <StatusPill tone={s.tone} className="shrink-0">{s.label}</StatusPill>
      </div>

      <dl className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-1.5"><dt className="font-medium text-foreground/80">Used by</dt><dd>{usedBy.join(', ')}</dd></div>
        <div className="flex flex-wrap gap-x-1.5"><dt className="font-medium text-foreground/80">Connects via</dt><dd>{modes}</dd></div>
        {integration && (
          <div className="flex flex-wrap gap-x-1.5">
            <dt className="font-medium text-foreground/80">Using</dt>
            <dd className="[overflow-wrap:anywhere]">
              {integration.mode === 'mcp' ? `MCP · ${integration.tools.length} tools` : 'API key'}
              {integration.keyPreview ? ` · key ${integration.keyPreview}` : ''}
              {integration.lastTestedAt ? ` · tested ${timeAgo(integration.lastTestedAt)}` : ''}
            </dd>
          </div>
        )}
      </dl>

      {integration?.status === 'error' && integration.lastError && (
        <p role="status" className="rounded-lg border border-[var(--status-critical)]/30 bg-[var(--status-critical)]/5 px-3 py-2 text-xs text-[var(--status-critical-ink)]">
          {integration.lastError}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {integration ? (
          <>
            <Button size="sm" variant="outline" onClick={onRetest} disabled={testing}>
              {testing ? <Loader2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />}
              Test again
            </Button>
            <Button size="sm" variant="ghost" onClick={onConnect}>Replace key</Button>
            <Button size="sm" variant="ghost" onClick={onRemove} className="ml-auto text-[var(--status-critical-ink)] hover:text-[var(--status-critical-ink)]">
              <Trash2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Disconnect<span className="sr-only"> {name}</span>
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onConnect}>Connect<span className="sr-only"> {name}</span></Button>
        )}
      </div>
    </article>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const [items, setItems] = useState<IntegrationView[] | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [removing, setRemoving] = useState<IntegrationView | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setItems(json.integrations || [])
    } catch {
      toast.error('Could not load your connections.')
      setItems([])
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const bySlug = useMemo(() => new Map((items || []).map((i) => [i.slug, i])), [items])
  const customs = (items || []).filter((i) => i.provider === 'custom-mcp')
  const connectedCount = (items || []).filter((i) => i.status === 'connected').length
  const hasResearch = (items || []).some((i) => i.status === 'connected' && getProvider(i.provider)?.category === 'research')

  function upsert(i: IntegrationView) {
    setItems((prev) => [...(prev || []).filter((p) => p.slug !== i.slug), i])
    setTarget(null)
  }

  async function retest(slug: string) {
    setTesting(slug)
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(slug)}`, { method: 'POST' })
      const json = await res.json()
      if (json.ok) toast.success(json.message)
      else toast.error(json.message || 'Test failed')
      await load()
    } finally {
      setTesting(null)
    }
  }

  async function remove(i: IntegrationView) {
    const res = await fetch(`/api/integrations/${encodeURIComponent(i.slug)}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Could not disconnect. Try again.')
      return
    }
    setItems((prev) => (prev || []).filter((p) => p.slug !== i.slug))
    toast.success(`${i.label || i.provider} disconnected. Its key was deleted.`)
  }

  if (items === null) return <PageSkeleton rows={3} grid />

  const modesOf = (p: ProviderDef) => [p.api ? 'API key' : null, p.mcp ? 'MCP server' : null].filter(Boolean).join(' or ')

  return (
    <div className="space-y-8">
      <PageHeader
        title="Connections"
        description="Optional tools that make your agents stronger. OpenAI in Settings already covers copy and images; add these for web research, more image and video models, and voice."
        meta={
          <>
            <StatusPill tone={connectedCount > 0 ? 'good' : 'neutral'} icon={connectedCount > 0 ? CheckCircle2 : Plug}>
              {connectedCount} connected
            </StatusPill>
            <StatusPill tone="neutral" icon={ShieldCheck}>Keys encrypted in Vault</StatusPill>
          </>
        }
      />

      {!hasResearch && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Search aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-medium">The research agent has nothing to search with yet</p>
              <p className="text-xs leading-relaxed text-muted-foreground">Connect one research tool so it can read competitor sites, prices and reviews. Tavily has a free tier.</p>
            </div>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => setTarget({ kind: 'provider', provider: getProvider('tavily')! })}>Connect Tavily</Button>
        </div>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const Icon = CATEGORY_ICON[cat]
        const list = PROVIDERS.filter((p) => p.category === cat)
        return (
          <section key={cat} aria-labelledby={`cat-${cat}`} className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 id={`cat-${cat}`} className="font-heading text-lg font-semibold">{CATEGORY_LABELS[cat].title}</h2>
                <p className="text-sm text-muted-foreground">{CATEGORY_LABELS[cat].description}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((p) => (
                <ConnectionCard
                  key={p.id}
                  name={p.name}
                  blurb={p.blurb}
                  usedBy={p.usedBy}
                  modes={modesOf(p)}
                  integration={bySlug.get(p.id)}
                  testing={testing === p.id}
                  onConnect={() => setTarget({ kind: 'provider', provider: p })}
                  onRetest={() => retest(p.id)}
                  onRemove={() => { const i = bySlug.get(p.id); if (i) setRemoving(i) }}
                />
              ))}
            </div>
          </section>
        )
      })}

      <section aria-labelledby="cat-custom" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
              <Plug aria-hidden="true" className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 id="cat-custom" className="font-heading text-lg font-semibold">{CATEGORY_LABELS.custom.title}</h2>
              <p className="text-sm text-muted-foreground">{CATEGORY_LABELS.custom.description}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setTarget({ kind: 'custom' })}>
            <Network aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Add MCP server
          </Button>
        </div>
        {customs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-5 py-6 text-center text-sm text-muted-foreground">
            No custom servers yet. Add one if a tool you use publishes an MCP URL.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {customs.map((i) => (
              <ConnectionCard
                key={i.slug}
                name={i.label || i.slug}
                blurb={i.mcpUrl || CUSTOM_MCP.blurb}
                usedBy={CUSTOM_MCP.usedBy}
                modes="MCP server"
                integration={i}
                testing={testing === i.slug}
                onConnect={() => setTarget({ kind: 'custom' })}
                onRetest={() => retest(i.slug)}
                onRemove={() => setRemoving(i)}
              />
            ))}
          </div>
        )}
      </section>

      <aside className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
        <p>
          Web research runs on its own. Anything else a connected tool does, like generating a video or running a scraper, can use that
          provider&apos;s credits, so the agent asks for your approval first, unless you turned on auto-optimize in Settings.
          {' '}<XCircle aria-hidden="true" className="inline h-3 w-3" /> Disconnecting deletes the stored key.
        </p>
      </aside>

      <ConnectDialog
        key={target ? (target.kind === 'provider' ? target.provider.id : 'custom') : 'closed'}
        target={target}
        existing={target?.kind === 'provider' ? bySlug.get(target.provider.id) : undefined}
        onClose={() => setTarget(null)}
        onConnected={upsert}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Disconnect ${removing?.label || removing?.provider || ''}?`}
        description="The stored key is deleted and the agents lose access straight away. You can connect again any time."
        confirmLabel="Disconnect"
        destructive
        onConfirm={async () => { if (removing) await remove(removing) }}
      />
    </div>
  )
}
