'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { PageHeader, Section, StatusPill } from '@/components/ui/metric'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LogOut, ArrowRight, User } from 'lucide-react'

/**
 * Account. The sign-in identity and a one-glance summary of what is set up,
 * each linking to the page where it is actually managed.
 */

interface ProfileData {
  user: { id: string; email: string | null; name: string; createdAt: string | null }
  connection: { connected: boolean; adAccountName: string | null; adAccountId: string | null }
  aiConfig: { configured: boolean; provider: string | null; model: string | null }
}

function initials(name: string): string {
  const parts = name.split(/[\s@.]+/).filter(Boolean)
  return (parts.map((p) => p[0]).slice(0, 2).join('') || '?').toUpperCase()
}

export default function ProfilePage() {
  const router = useRouter()
  const [data, setData] = useState<ProfileData | null>(null)
  const [business, setBusiness] = useState<{ businessName: string | null; primaryLanguageLabel: string } | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/profile').then((r) => r.json()),
      fetch('/api/business-profile').then((r) => r.json()).catch(() => null),
    ]).then(([p, b]) => { setData(p); setBusiness(b?.profile ?? null); setMissing(b?.missing ?? []) })
      .catch(() => toast.error('Could not load account'))
      .finally(() => setLoading(false))
  }, [])

  async function signOut() {
    setSigningOut(true)
    try {
      await createClient().auth.signOut()
      router.replace('/login')
      router.refresh()
    } catch {
      toast.error('Could not sign out')
      setSigningOut(false)
    }
  }

  if (loading || !data) return <PageSkeleton rows={2} />

  const name = data.user.name || data.user.email || 'You'

  return (
    <div className="space-y-6">
      <PageHeader
        icon={User} title="Account" description="Who is signed in, and what is set up." actions={<Button variant="outline" onClick={signOut} disabled={signingOut}><LogOut aria-hidden="true" className="mr-1.5 h-4 w-4" /> Sign out</Button>} />

      <Section title="Signed in as">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary" aria-hidden="true">{initials(name)}</div>
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="truncate text-sm text-muted-foreground">{data.user.email}</p>
            {data.user.createdAt && <p className="text-xs text-muted-foreground">Since {new Date(data.user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
          </div>
        </div>
      </Section>

      <Section title="Setup" description="Each of these is managed on its own page.">
        <ul className="divide-y divide-border">
          <SetupRow href="/business" label="Business Profile" value={business?.businessName ? `${business.businessName} · ${business.primaryLanguageLabel}` : 'Not filled in'} tone={missing.length === 0 ? 'good' : business?.businessName ? 'warning' : 'critical'} status={missing.length === 0 ? 'Complete' : `${missing.length} missing`} />
          <SetupRow href="/connect" label="Meta Connection" value={data.connection.connected ? `${data.connection.adAccountName || 'Ad account'} · ${data.connection.adAccountId || ''}` : 'Not connected'} tone={data.connection.connected ? 'good' : 'critical'} status={data.connection.connected ? 'Connected' : 'Missing'} />
          <SetupRow href="/settings" label="AI brain" value={data.aiConfig.configured ? `${data.aiConfig.provider} · ${data.aiConfig.model}` : 'Not configured'} tone={data.aiConfig.configured ? 'good' : 'critical'} status={data.aiConfig.configured ? 'Ready' : 'Missing'} />
        </ul>
      </Section>
    </div>
  )
}

function SetupRow({ href, label, value, tone, status }: { href: string; label: string; value: string; tone: 'good' | 'warning' | 'critical'; status: string }) {
  return (
    <li>
      <Link href={href} className="group flex items-center gap-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{value}</p>
        </div>
        <StatusPill tone={tone}>{status}</StatusPill>
        <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  )
}
