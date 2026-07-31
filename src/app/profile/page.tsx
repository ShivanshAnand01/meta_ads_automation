'use client'

import { useState, useCallback, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  User, Copy, ShieldCheck, ShieldAlert, Loader2,
  CheckCircle2, XCircle, Key, Server, Cpu, Sparkles, Link2,
  RefreshCw, Activity, Fingerprint, Clock,
} from 'lucide-react'

interface UserInfo {
  id: string
  email: string | null
  name: string
  createdAt: string | null
}

interface ConnectionInfo {
  connected: boolean
  appId: string | null
  appSecret: string | null
  accessToken: string | null
  adAccountId: string | null
  adAccountIdRaw: string | null
  adAccountName: string | null
  adAccountStatus: string | null
  adAccountCurrency: string | null
  connectedAt: string | null
}

interface AIConfig {
  configured: boolean
  provider: string | null
  model: string | null
  baseUrl: string | null
  apiKey: string | null
}

interface TokenTest {
  valid: boolean
  expiresAt?: number | null
  daysLeft?: number | null
  scopes?: string[]
  appId?: string | null
  appName?: string | null
  error?: string | null
}

interface ProfileData {
  user: UserInfo
  connection: ConnectionInfo
  aiConfig: AIConfig
  tokenTest: TokenTest | null
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return (parts.map((p) => p[0]).slice(0, 2).join('') || '?').toUpperCase()
}

function isMasked(v: string | null | undefined): boolean {
  return !!v && v.includes('••••')
}

function FieldRow({
  label, value, mono, copyable,
}: {
  label: string
  value: string | null
  mono?: boolean
  copyable?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-background/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-0.5 truncate text-sm font-medium ${mono ? 'font-mono' : ''}`}>
          {value || <span className="text-muted-foreground/60">Not set</span>}
        </p>
      </div>
      {copyable && value && !isMasked(value) && (
        <button
          onClick={() => { navigator.clipboard.writeText(value); toast.success('Copied') }}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Copy"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile')
      const json = await res.json()
      setData(json)
    } catch {
      toast.error('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfile()
  }, [fetchProfile])

  async function testConnection() {
    setTesting(true)
    try {
      const res = await fetch('/api/profile?test=1')
      const json = await res.json()
      const tt = json.tokenTest as TokenTest
      if (tt && tt.valid && tt.expiresAt) {
        tt.daysLeft = Math.max(0, Math.round((tt.expiresAt * 1000 - Date.now()) / 86400000))
      }
      setData((prev) => (prev ? { ...prev, tokenTest: tt } : prev))
      if (tt?.valid) {
        toast.success('Meta connection is healthy — token is valid')
      } else {
        toast.error(tt?.error || 'Meta token is invalid or expired')
      }
    } catch {
      toast.error('Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-40 rounded bg-muted" />
          <div className="h-64 rounded bg-muted" />
          <div className="h-48 rounded bg-muted" />
        </div>
      </div>
    )
  }

  const { user, connection, aiConfig, tokenTest } = data

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold tracking-tight gradient-text">Profile &amp; Connection</h1>
        <p className="text-muted-foreground">
          Your identity, Meta Ads credentials, and connection health — all in one place
        </p>
      </motion.div>

      {/* User Identity */}
      <Card className="glass card-3d">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-bg shadow-md">
              <User className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle>User Identity</CardTitle>
              <CardDescription>Your authenticated account on this platform</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl gradient-bg animate-gradient text-2xl font-bold text-white shadow-lg">
              {initials(user.name)}
            </div>
            <div className="flex-1">
              <div className="grid gap-2 sm:grid-cols-2">
                <FieldRow label="Name" value={user.name} copyable />
                <FieldRow label="Email" value={user.email} copyable />
                <FieldRow label="User ID" value={user.id} mono copyable />
                <FieldRow
                  label="Member Since"
                  value={user.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Meta Connection */}
      <Card className="glass card-3d">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-md ${connection.connected ? 'bg-gradient-to-br from-emerald-500 to-teal-500' : 'bg-gradient-to-br from-red-500 to-rose-600'}`}>
                {connection.connected ? <Link2 className="h-4 w-4 text-white" /> : <ShieldAlert className="h-4 w-4 text-white" />}
              </div>
              <div>
                <CardTitle>Meta Ads Connection</CardTitle>
                <CardDescription>
                  {connection.connected ? 'Your Meta Ads account is linked' : 'Not connected — link your Meta Ads account'}
                </CardDescription>
              </div>
            </div>
            {connection.connected ? (
              <Badge variant="default" className="gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Connected
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" />
                Disconnected
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {connection.connected ? (
            <>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ad Account</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <FieldRow label="Account Name" value={connection.adAccountName} />
                  <FieldRow label="Account ID" value={connection.adAccountId} mono copyable />
                  <FieldRow label="Currency" value={connection.adAccountCurrency} />
                  <FieldRow
                    label="Status"
                    value={
                      connection.adAccountStatus === '1' ? 'ACTIVE'
                      : connection.adAccountStatus === '2' ? 'SETTLED'
                      : connection.adAccountStatus === '3' ? 'DISABLED'
                      : connection.adAccountStatus || 'UNKNOWN'
                    }
                  />
                </div>
              </div>

              <Separator />

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Credentials</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <FieldRow label="App ID" value={connection.appId} mono copyable />
                  <FieldRow label="App Secret" value={connection.appSecret} mono copyable={false} />
                  <div className="sm:col-span-2">
                    <FieldRow label="Access Token" value={connection.accessToken} mono copyable={false} />
                  </div>
                  <FieldRow
                    label="Connected Since"
                    value={connection.connectedAt ? new Date(connection.connectedAt).toLocaleString() : 'N/A'}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Secrets are stored server-side and masked for security.
                </p>
              </div>

              <Separator />

              {/* Connection health */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connection Health</p>
                  <Button variant="outline" size="sm" onClick={testConnection} disabled={testing} className="glass">
                    {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Activity className="mr-1.5 h-3.5 w-3.5" />}
                    {testing ? 'Testing…' : 'Test Connection'}
                  </Button>
                </div>

                {tokenTest ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-xl border p-4 ${tokenTest.valid ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}
                  >
                    <div className="flex items-center gap-2">
                      {tokenTest.valid
                        ? <ShieldCheck className="h-5 w-5 text-emerald-500" />
                        : <ShieldAlert className="h-5 w-5 text-red-500" />}
                      <span className="text-sm font-semibold">
                        {tokenTest.valid ? 'Connection is healthy' : 'Connection has issues'}
                      </span>
                    </div>
                    {tokenTest.valid ? (
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          <span>Access token is <strong>valid</strong></span>
                        </div>
                        {tokenTest.expiresAt && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            <span>
                              Expires {new Date(tokenTest.expiresAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                              {tokenTest.daysLeft != null ? ` (${tokenTest.daysLeft} days left)` : ''}
                            </span>
                          </div>
                        )}
                        {tokenTest.appName && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Fingerprint className="h-3.5 w-3.5" />
                            <span>App: {tokenTest.appName}</span>
                          </div>
                        )}
                        {tokenTest.scopes && tokenTest.scopes.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {tokenTest.scopes.map((s) => (
                              <Badge key={s} variant="secondary" className="text-[10px] font-mono">{s}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-red-500">
                        {tokenTest.error || 'Token is invalid or expired. Reconnect your Meta account.'}
                      </p>
                    )}
                  </motion.div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Click <strong>Test Connection</strong> to validate your access token against Meta live and check its expiry &amp; permissions.
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => window.location.href = '/connect'} className="glass">
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Manage Connection
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <ShieldAlert className="h-10 w-10 text-amber-500" />
              <div>
                <p className="text-sm font-medium">No Meta Ads account connected</p>
                <p className="text-xs text-muted-foreground">Connect your account to enable campaign management, insights sync, and live ad operations.</p>
              </div>
              <Button onClick={() => window.location.href = '/connect'} className="gradient-bg animate-gradient">
                <Link2 className="mr-2 h-4 w-4" />
                Connect Meta Ads
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Brain */}
      <Card className="glass card-3d">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-bg shadow-md">
                {aiConfig.provider === 'anthropic' ? <Sparkles className="h-4 w-4 text-white" />
                  : aiConfig.provider === 'ollama' ? <Cpu className="h-4 w-4 text-white" />
                  : aiConfig.provider === 'groq' ? <Server className="h-4 w-4 text-white" />
                  : <Key className="h-4 w-4 text-white" />}
              </div>
              <div>
                <CardTitle>AI Brain</CardTitle>
                <CardDescription>The AI provider powering your AI Manager</CardDescription>
              </div>
            </div>
            {aiConfig.configured ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Configured
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" />
                Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {aiConfig.configured ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <FieldRow label="Provider" value={aiConfig.provider} />
              <FieldRow label="Model" value={aiConfig.model} mono />
              <FieldRow label="Base URL" value={aiConfig.baseUrl} mono />
              <FieldRow label="API Key" value={aiConfig.apiKey} mono copyable={false} />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-xs text-muted-foreground">Configure your AI brain to enable the AI Manager.</p>
              <Button variant="outline" size="sm" onClick={() => window.location.href = '/settings'} className="glass">
                Go to Settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
