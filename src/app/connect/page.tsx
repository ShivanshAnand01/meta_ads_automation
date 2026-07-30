'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Link2, CheckCircle2, Loader2, ExternalLink, Copy } from 'lucide-react'
import { motion } from 'framer-motion'

interface ConnectionData {
  connected: boolean
  appId?: string
  adAccountId?: string
  adAccountName?: string
  adAccountStatus?: string
  adAccountCurrency?: string
  connectedAt?: string
}

interface AdAccount {
  id: string
  name: string
  account_id: string
  account_status: number
  currency: string
  balance: string
  amount_spent: string
}

export default function ConnectPage() {
  const [data, setData] = useState<ConnectionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [selectedAccount, setSelectedAccount] = useState('')
  const [showReconnectForm, setShowReconnectForm] = useState(false)

  useEffect(() => {
    fetchConnection()
  }, [])

  async function fetchConnection() {
    try {
      const res = await fetch('/api/dashboard')
      const json = await res.json()
      setData({
        connected: json.connected,
        appId: json.adAccount?.appId,
        adAccountId: json.adAccount?.accountId,
        adAccountName: json.adAccount?.name,
        adAccountStatus: json.adAccount?.status,
        adAccountCurrency: json.adAccount?.currency,
        connectedAt: json.adAccount?.connectedAt,
      })
    } catch {
      setData({ connected: false })
    } finally {
      setLoading(false)
    }
  }

  async function handleConnect() {
    if (!appId || !appSecret || !accessToken) {
      toast.error('All fields are required')
      return
    }

    setConnecting(true)
    try {
      const res = await fetch('/api/meta/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, appSecret, accessToken }),
      })
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'Connection failed')
      }

      toast.success('Connected to Meta Ads successfully!')
      fetchConnection()
      loadAccounts()
      setShowReconnectForm(false)
      setAppId('')
      setAppSecret('')
      setAccessToken('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  async function loadAccounts() {
    setLoadingAccounts(true)
    try {
      const res = await fetch('/api/meta/accounts')
      const json = await res.json()
      if (json.accounts) {
        setAccounts(json.accounts)
      }
    } catch {
      toast.error('Failed to load ad accounts')
    } finally {
      setLoadingAccounts(false)
    }
  }

  async function selectAccount(account: AdAccount) {
    try {
      const res = await fetch(`/api/meta/accounts/${account.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: account.name,
          status: String(account.account_status),
          currency: account.currency,
        }),
      })
      if (res.ok) {
        toast.success('Ad account selected')
        fetchConnection()
      }
    } catch {
      toast.error('Failed to select account')
    }
  }

  function copyOAuthUrl() {
    const currentUrl = window.location.origin + '/connect'
    navigator.clipboard.writeText(currentUrl)
    toast.success('OAuth redirect URL copied to clipboard')
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-64 rounded bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold tracking-tight gradient-text">Meta Connection</h1>
        <p className="text-muted-foreground">
          Connect your Meta Ads account to manage campaigns and creatives
        </p>
      </motion.div>

      {data?.connected ? (
        <>
        <Card className="glass card-3d">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 shadow-md">
                  <CheckCircle2 className="h-5 w-5 text-white" />
                </div>
                <CardTitle>Connected to Meta Ads</CardTitle>
              </div>
              <Badge variant="default">Active</Badge>
            </div>
            <CardDescription>Your Meta Ads account is connected</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-muted-foreground">Ad Account Name</Label>
                <p className="text-sm font-medium">{data.adAccountName || 'Not selected'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Ad Account ID</Label>
                <p className="text-sm font-medium">{data.adAccountId || 'Not selected'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Currency</Label>
                <p className="text-sm font-medium">{data.adAccountCurrency || 'N/A'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Connected Since</Label>
                <p className="text-sm font-medium">
                  {data.connectedAt ? new Date(data.connectedAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Select Ad Account</Label>
                <Button variant="outline" size="sm" onClick={loadAccounts} disabled={loadingAccounts} className="glass card-3d">
                  {loadingAccounts ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load Accounts'}
                </Button>
              </div>
              {accounts.length > 0 && (
                <div className="space-y-2">
                  {accounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{account.name}</p>
                        <p className="text-xs text-muted-foreground">
                          ID: {account.account_id} • {account.currency} •
                          Spent: ₹{account.amount_spent || '0'}
                        </p>
                      </div>
                      <Button
                        variant={selectedAccount === account.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setSelectedAccount(account.id)
                          selectAccount(account)
                        }}
                      >
                        {selectedAccount === account.id ? 'Selected' : 'Select'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowReconnectForm(!showReconnectForm)
                  setAppId('')
                  setAppSecret('')
                  setAccessToken('')
                }}
                className="glass card-3d"
              >
                {showReconnectForm ? 'Cancel' : 'Reconnect'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {showReconnectForm && (
          <Card className="glass card-3d border-amber-500/30">
            <CardHeader>
              <CardTitle>Reconnect with New Credentials</CardTitle>
              <CardDescription>
                Your current connection remains active until new credentials are verified.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="appId">App ID</Label>
                <Input
                  id="appId"
                  placeholder="1234567890123456"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appSecret">App Secret</Label>
                <Input
                  id="appSecret"
                  type="password"
                  placeholder="Your app secret"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accessToken">Access Token</Label>
                <Input
                  id="accessToken"
                  type="password"
                  placeholder="Your access token with ads_management scope"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Generate a token with ads_management, ads_read, and business_management permissions
                </p>
              </div>
              <Button
                onClick={handleConnect}
                disabled={connecting || !appId || !appSecret || !accessToken}
                className="w-full gradient-bg animate-gradient shadow-lg card-3d"
              >
                {connecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 h-4 w-4" />
                    Reconnect to Meta Ads
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
        </>
      ) : (
        <div className="space-y-6">
          <Card className="glass card-3d">
            <CardHeader>
              <CardTitle>Step 1: Create a Meta Developer App</CardTitle>
              <CardDescription>
                You need a Meta Developer App to connect your ads account. Follow these steps:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
                <p>1. Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline inline-flex items-center gap-1">Meta Developers <ExternalLink className="h-3 w-3" /></a></p>
                <p>2. Click &quot;Create App&quot; and select &quot;Business&quot; type</p>
                <p>3. Add &quot;Marketing API&quot; product to your app</p>
                <p>4. Copy your <strong>App ID</strong> and <strong>App Secret</strong> from App Settings</p>
                <p>5. Generate an <strong>Access Token</strong> with ads_management permission</p>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm">OAuth Redirect URL:</Label>
                <code className="rounded bg-muted px-2 py-1 text-xs">
                  {typeof window !== 'undefined' ? window.location.origin + '/connect' : 'https://your-domain.com/connect'}
                </code>
                <Button variant="ghost" size="sm" onClick={copyOAuthUrl}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="glass card-3d">
            <CardHeader>
              <CardTitle>Step 2: Enter Your App Credentials</CardTitle>
              <CardDescription>
                Enter your Meta Developer App credentials to connect
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="appId">App ID</Label>
                <Input
                  id="appId"
                  placeholder="1234567890123456"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appSecret">App Secret</Label>
                <Input
                  id="appSecret"
                  type="password"
                  placeholder="Your app secret"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accessToken">Access Token</Label>
                <Input
                  id="accessToken"
                  type="password"
                  placeholder="Your access token with ads_management scope"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Generate a token with ads_management, ads_read, and business_management permissions
                </p>
              </div>
              <Button
                onClick={handleConnect}
                disabled={connecting || !appId || !appSecret || !accessToken}
                className="w-full gradient-bg animate-gradient shadow-lg card-3d"
              >
                {connecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 h-4 w-4" />
                    Connect to Meta Ads
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
