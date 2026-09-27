'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { AiOrb } from '@/components/chat/ai-orb'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { toast } from 'sonner'
import { Loader2, ArrowLeft, Eye, EyeOff } from 'lucide-react'

type AuthMode = 'signin' | 'signup' | 'reset'

/**
 * Self-serve signup is controlled by NEXT_PUBLIC_ALLOW_SIGNUP.
 *
 * This is a multi-tenant product: each business signs up, connects its own
 * Meta app and gets its own profile, so signup is ON in production. Set the
 * flag to anything but "true" to close registration for a private install.
 */
const ALLOW_SIGNUP = process.env.NEXT_PUBLIC_ALLOW_SIGNUP === 'true'

function safeNext(v: string | null): string {
  if (!v) return '/'
  try {
    const u = new URL(v, window.location.origin)
    if (u.origin !== window.location.origin) return '/'
    return `${u.pathname}${u.search}${u.hash}` || '/'
  } catch {
    return '/'
  }
}

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeNext(searchParams.get('next'))

  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})

  useEffect(() => {
    const supabase = createClient()
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (user) router.replace(next)
        else setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [router, next])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!email.trim()) errs.email = 'Enter your email address.'
    if (mode !== 'reset' && !password) errs.password = 'Enter your password.'
    if (mode === 'signup' && password && password.length < 8) errs.password = 'Use at least 8 characters.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setLoading(true)
    setNeedsConfirmation(false)

    const supabase = createClient()
    try {
      if (mode === 'signup') {
        if (!ALLOW_SIGNUP) {
          toast.error('Sign-ups are closed on this install. Ask your administrator for access.')
          setMode('signin')
          return
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        })
        if (error) throw error

        if (data.user && data.user.identities && data.user.identities.length === 0) {
          toast.error('An account with this email already exists. Sign in instead.')
          setMode('signin')
        } else if (data.session) {
          toast.success('Account created. Welcome to AdManager.')
          router.replace(next)
          router.refresh()
        } else {
          setNeedsConfirmation(true)
          toast.success('Account created. Check your email to confirm, then sign in.')
        }
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/settings`,
        })
        if (error) throw error
        toast.success('Password reset link sent. Check your email.')
        setMode('signin')
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) {
          if (error.message.toLowerCase().includes('email not confirmed')) setNeedsConfirmation(true)
          throw error
        }
        if (!data.session) throw new Error('No session returned')
        router.replace(next)
        router.refresh()
      }
    } catch (err) {
      console.error('[login] error', err)
      toast.error(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  async function resendConfirmation() {
    if (!email.trim()) { setErrors({ email: 'Enter your email first.' }); return }
    const supabase = createClient()
    setLoading(true)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      if (error) throw error
      toast.success('Confirmation email sent. Check your inbox.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend confirmation')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 aria-label="Loading" className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const title = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset your password'
  const subtitle = mode === 'signin' ? 'Your ads, your language, your caps.' : mode === 'signup' ? 'Connect your own Meta app. Nothing is shared between businesses.' : 'We will email you a link to set a new one.'

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel: the agent, and three promises in plain words. */}
      <aside aria-hidden="true" className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_10%,color-mix(in_oklch,var(--gradient-start)_35%,transparent),transparent_70%),radial-gradient(50%_45%_at_90%_90%,color-mix(in_oklch,var(--gradient-end)_28%,transparent),transparent_70%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px] [mask-image:radial-gradient(70%_60%_at_50%_45%,#000,transparent)]" />
        <div className="relative flex items-center gap-3">
          <AiOrb size={36} />
          <p className="text-lg font-semibold">AdManager</p>
        </div>
        <div className="relative">
          <div className="mb-10 flex flex-col items-start">
            <AiOrb size={120} />
            <div className="ai-orb-shadow mt-3 w-24 opacity-60" />
          </div>
          <p className="max-w-md text-balance text-4xl font-semibold leading-[1.1] tracking-tight">Your Meta ads, run by an agent that knows your business.</p>
          <ul className="mt-8 space-y-3 text-[15px] text-sidebar-foreground/80">
            <li className="flex items-center gap-3"><span className="h-1.5 w-1.5 rounded-full bg-[var(--gradient-end)]" />Writes ads in your customers&apos; language</li>
            <li className="flex items-center gap-3"><span className="h-1.5 w-1.5 rounded-full bg-[var(--gradient-mid)]" />Never spends past the caps you set</li>
            <li className="flex items-center gap-3"><span className="h-1.5 w-1.5 rounded-full bg-[var(--gradient-start)]" />Asks before anything goes live</li>
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-foreground/55">Your own Meta app. Nothing is shared between businesses.</p>
      </aside>

      <div className="flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <AiOrb size={40} />
          <div>
            <p className="text-lg font-semibold leading-tight">AdManager</p>
            <p className="text-xs text-muted-foreground">Meta ads, run by an agent that knows your business</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 elev-2 sm:p-7">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            <Field label="Email" required error={errors.email}>
              {({ id, describedBy, invalid }) => (
                <input id={id} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.in" aria-describedby={describedBy} aria-invalid={invalid || undefined} disabled={loading}
                  className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-primary/60 focus:ring-4 focus:ring-primary/15 md:text-sm dark:bg-input/30" />
              )}
            </Field>

            {mode !== 'reset' && (
              <Field label="Password" required error={errors.password}
                trailing={mode === 'signin' ? <button type="button" onClick={() => setMode('reset')} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Forgot?</button> : undefined}>
                {({ id, describedBy, invalid }) => (
                  <div className="relative">
                    <input id={id} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'} aria-describedby={describedBy} aria-invalid={invalid || undefined} disabled={loading}
                      className="h-11 w-full rounded-xl border border-input bg-card pl-3 pr-11 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-primary/60 focus:ring-4 focus:ring-primary/15 md:text-sm dark:bg-input/30" />
                    <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                      {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              </Field>
            )}

            {needsConfirmation && (
              <div className="rounded-lg bg-[var(--status-warning)]/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                Your email is not confirmed yet.{' '}
                <button type="button" onClick={resendConfirmation} className="font-medium underline underline-offset-2" disabled={loading}>Resend the confirmation email</button>.
              </div>
            )}

            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </Button>
          </form>

          <div className="mt-5 text-center text-sm text-muted-foreground">
            {mode === 'reset' ? (
              <button type="button" onClick={() => setMode('signin')} className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" /> Back to sign in</button>
            ) : mode === 'signin' ? (
              ALLOW_SIGNUP ? <>New here? <button type="button" onClick={() => setMode('signup')} className="font-medium text-foreground underline-offset-2 hover:underline">Create an account</button></> : <>Accounts are created by your administrator.</>
            ) : (
              <>Already have an account? <button type="button" onClick={() => setMode('signin')} className="font-medium text-foreground underline-offset-2 hover:underline">Sign in</button></>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
