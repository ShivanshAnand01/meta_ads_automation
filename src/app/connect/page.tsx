'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageHeader, Section, StatusPill, type StatusTone } from '@/components/ui/metric'
import { TextField, Field } from '@/components/ui/field'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Link2, ExternalLink, Loader2, Eye, EyeOff, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'

/**
 * Meta Connection: bring-your-own-app.
 *
 * Each business connects its own Meta app and token. This page is a guided
 * three-step flow because the owner does this once, probably while reading
 * Meta's developer site in another tab, and the failure modes (wrong token
 * type, missing scope, no Page access) are all invisible unless we check
 * and name them.
 */

interface Status {
  connection: {
    connected: boolean
    appId: string | null
    adAccountId: string | null
    adAccountName: string | null
    adAccountStatus: string | null
    adAccountCurrency: string | null
    connectedAt: string | null
  }
  tokenTest: { valid: boolean; expiresAt?: number | null; scopes?: string[]; appName?: string | null; error?: string | null } | null
}

interface ConnectResult {
  connected?: boolean
  success?: boolean
  error?: string
  adAccountId: string | null
  adAccountName: string | null
  adAccountCurrency: string | null
  availableAccounts: Array<{ id: string; name: string; currency: string; status: string }>
  tokenExpiry: string | null
  scopes: string[]
  missingScopes: string[]
}

const REQUIRED_SCOPES: Array<{ scope: string; why: string }> = [
  { scope: 'ads_management', why: 'Create and edit campaigns' },
  { scope: 'ads_read', why: 'Read spend and results' },
  { scope: 'business_management', why: 'See the ad account and pixels' },
  { scope: 'pages_show_list', why: 'Publish ads from your Facebook Page' },
  { scope: 'pages_read_engagement', why: 'Attach the Page to link ads' },
  { scope: 'pages_manage_ads', why: 'Run ads from your Page' },
]

function daysUntil(ts: number | string | null | undefined): number | null {
  if (!ts) return null
  const ms = typeof ts === 'number' ? (ts > 1e12 ? ts : ts * 1000) : Date.parse(ts)
  if (!Number.isFinite(ms)) return null
  return Math.floor((ms - Date.now()) / 86_400_000)
}

export default function ConnectPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/profile?test=1')
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setStatus({ connection: j.connection, tokenTest: j.tokenTest }) })
      .catch(() => toast.error('Could not load connection status'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  if (loading) return <PageSkeleton rows={2} />

  const connected = Boolean(status?.connection?.connected)
  const showForm = !connected || editing

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Link2}
        title="Meta Connection"
        description="Your own Meta app and token. The platform only ever acts inside this account."
        meta={connected ? <StatusPill tone={status?.tokenTest?.valid === false ? 'critical' : 'good'}>{status?.tokenTest?.valid === false ? 'Token invalid' : 'Connected'}</StatusPill> : <StatusPill tone="neutral">Not connected</StatusPill>}
        actions={connected && !editing ? (
          <>
            <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}><RefreshCw aria-hidden="true" className="mr-1.5 h-4 w-4" /> Re-check</Button>
            <Button variant="outline" onClick={() => setEditing(true)}>Replace token</Button>
          </>
        ) : undefined}
      />

      {connected && status && <StatusCard status={status} />}

      {showForm && (
        <ConnectForm
          onDone={() => { setEditing(false); setReloadKey((k) => k + 1) }}
          onCancel={connected ? () => setEditing(false) : undefined}
        />
      )}
    </div>
  )
}

function StatusCard({ status }: { status: Status }) {
  const { connection: c, tokenTest: t } = status
  const days = daysUntil(t?.expiresAt)
  const expiryTone: StatusTone = days == null ? 'neutral' : days <= 3 ? 'critical' : days <= 14 ? 'warning' : 'good'
  const scopes = new Set(t?.scopes || [])
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.has(s.scope))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
      <Section title="Ad account" description="Everything the AI does happens here.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{c.adAccountName || '—'}</dd>
          <dt className="text-muted-foreground">Account ID</dt><dd className="tabular">{c.adAccountId || '—'}</dd>
          <dt className="text-muted-foreground">Currency</dt><dd>{c.adAccountCurrency || '—'}</dd>
          <dt className="text-muted-foreground">App</dt><dd>{t?.appName || c.appId || '—'}</dd>
          <dt className="text-muted-foreground">Connected</dt><dd>{c.connectedAt ? new Date(c.connectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</dd>
        </dl>
      </Section>

      <Section title="Token health" description="Checked live against Meta just now.">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {t?.valid ? <StatusPill tone="good">Valid</StatusPill> : <StatusPill tone="critical">{t?.error || 'Invalid or expired'}</StatusPill>}
            {days != null && (
              <StatusPill tone={expiryTone}>
                {days < 0 ? 'Expired' : days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`}
              </StatusPill>
            )}
            {t?.expiresAt === 0 && <StatusPill tone="good">Never expires</StatusPill>}
          </div>
          {days != null && days <= 14 && days >= 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              When it expires every automation stops. Generate a new token in the Graph API Explorer and paste it with <strong className="text-foreground">Replace token</strong> above.
            </p>
          )}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Permissions</p>
            <ul className="space-y-1.5">
              {REQUIRED_SCOPES.map((s) => {
                const ok = scopes.has(s.scope)
                return (
                  <li key={s.scope} className="flex items-start gap-2 text-sm">
                    {ok ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-good-ink)]" /> : <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-critical-ink)]" />}
                    <span><code className="text-xs">{s.scope}</code> <span className="text-muted-foreground">· {s.why}</span>{!ok && <span className="sr-only"> (missing)</span>}</span>
                  </li>
                )
              })}
            </ul>
            {missing.some((m) => m.scope.startsWith('pages_')) && (
              <p className="mt-3 rounded-lg bg-[var(--status-warning)]/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                Without the Page permissions Meta will refuse to publish link ads. Regenerate the token with them ticked.
              </p>
            )}
          </div>
        </div>
      </Section>
    </div>
  )
}

function ConnectForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [form, setForm] = useState({ appId: '', appSecret: '', accessToken: '' })
  const [show, setShow] = useState({ appSecret: false, accessToken: false })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ConnectResult | null>(null)
  const [pickedAccount, setPickedAccount] = useState<string>('')

  async function connect() {
    const errs: Record<string, string> = {}
    if (!/^\d{5,}$/.test(form.appId.trim())) errs.appId = 'App ID is a number, from the top of your app dashboard.'
    if (form.appSecret.trim().length < 16) errs.appSecret = 'App Secret is a 32-character string under Settings → Basic.'
    if (form.accessToken.trim().length < 30) errs.accessToken = 'Paste the full token from the Graph API Explorer.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setBusy(true)
    try {
      const res = await fetch('/api/meta/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const j: ConnectResult = await res.json()
      if (!res.ok || j.error) throw new Error(j.error || 'Meta rejected the connection')
      setResult(j)
      setPickedAccount(j.adAccountId || '')
      setForm({ appId: '', appSecret: '', accessToken: '' })
      if (j.missingScopes?.length) toast.warning(`Connected, but the token is missing: ${j.missingScopes.join(', ')}`)
      else toast.success(`Connected to ${j.adAccountName || 'your ad account'}`)
      if ((j.availableAccounts?.length ?? 0) <= 1) onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  async function chooseAccount() {
    if (!pickedAccount) return
    setBusy(true)
    try {
      const res = await fetch('/api/meta/connect', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adAccountId: pickedAccount }) })
      const j = await res.json()
      if (!res.ok || !j.success) throw new Error(j.error || 'Could not select that account')
      toast.success('Ad account selected')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not select that account')
    } finally {
      setBusy(false)
    }
  }

  if (result && result.availableAccounts.length > 1) {
    return (
      <Section title="Which ad account?" description="The token can see more than one. Pick the one this business spends from.">
        <div className="space-y-4">
          <Field label="Ad account">
            {({ id }) => (
              <Select value={pickedAccount} onValueChange={(v) => { if (v) setPickedAccount(v) }}>
                <SelectTrigger id={id} className="h-10 w-full sm:w-96"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                <SelectContent>
                  {result.availableAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} · {a.currency} · {a.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Button onClick={chooseAccount} disabled={busy || !pickedAccount}>
            {busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />} Use this account
          </Button>
        </div>
      </Section>
    )
  }

  return (
    <Section title={onCancel ? 'Replace the token' : 'Connect your Meta app'} description="Three steps, about ten minutes the first time. Nothing here is shared with any other business." action={onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}>
      <ol className="space-y-8">
        <Step n={1} title="Create a Meta app" done={Boolean(form.appId)}>
          <p className="text-sm text-muted-foreground">
            Go to <a className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline" href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">developers.facebook.com/apps <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>, click <strong className="text-foreground">Create App</strong>, choose <strong className="text-foreground">Business</strong>, and add the <strong className="text-foreground">Marketing API</strong> product. Then open <strong className="text-foreground">App settings → Basic</strong>.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField label="App ID" required inputMode="numeric" autoComplete="off" value={form.appId} onChange={(v) => setForm({ ...form, appId: v })} error={errors.appId} placeholder="1234567890123456" />
            <SecretField label="App Secret" required value={form.appSecret} onChange={(v) => setForm({ ...form, appSecret: v })} error={errors.appSecret} shown={show.appSecret} onToggle={() => setShow({ ...show, appSecret: !show.appSecret })} placeholder="Click Show next to App Secret, then paste" />
          </div>
        </Step>

        <Step n={2} title="Generate an access token" done={Boolean(form.accessToken)}>
          <p className="text-sm text-muted-foreground">
            Open the <a className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">Graph API Explorer <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>, select your app, and under <strong className="text-foreground">Permissions</strong> tick every one of these before you click <strong className="text-foreground">Generate Access Token</strong>:
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {REQUIRED_SCOPES.map((s) => <li key={s.scope}><code className="rounded-md bg-muted px-2 py-1 text-xs">{s.scope}</code></li>)}
          </ul>
          <SecretField label="Access token" required value={form.accessToken} onChange={(v) => setForm({ ...form, accessToken: v })} error={errors.accessToken} shown={show.accessToken} onToggle={() => setShow({ ...show, accessToken: !show.accessToken })} placeholder="EAAB…" hint="A short-lived token is fine. It is exchanged for a 60-day one automatically." />
        </Step>

        <Step n={3} title="Connect" done={false}>
          <p className="text-sm text-muted-foreground">The token is verified with Meta, its permissions are checked, and your ad accounts are listed. Secrets are stored encrypted.</p>
          <Button onClick={connect} disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 aria-hidden="true" className="mr-1.5 h-4 w-4" />}
            {busy ? 'Checking with Meta…' : 'Connect to Meta'}
          </Button>
        </Step>
      </ol>
    </Section>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-1 gap-3 sm:grid-cols-[2rem_1fr]">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${done ? 'bg-[var(--status-good)] text-white' : 'bg-muted text-muted-foreground'}`} aria-hidden="true">
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </div>
      <div className="min-w-0 space-y-3">
        <h3 className="text-sm font-semibold"><span className="sr-only">Step {n}: </span>{title}</h3>
        {children}
      </div>
    </li>
  )
}

function SecretField({ label, value, onChange, error, shown, onToggle, placeholder, hint, required }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; shown: boolean; onToggle: () => void; placeholder?: string; hint?: string; required?: boolean
}) {
  return (
    <Field label={label} required={required} error={error} hint={hint} trailing={
      <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-pressed={shown}>
        {shown ? <EyeOff aria-hidden="true" className="h-3.5 w-3.5" /> : <Eye aria-hidden="true" className="h-3.5 w-3.5" />} {shown ? 'Hide' : 'Show'}
      </button>
    }>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className="h-10 w-full rounded-lg border border-input bg-transparent px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/50 aria-invalid:border-[var(--status-critical)] dark:bg-input/30"
        />
      )}
    </Field>
  )
}
