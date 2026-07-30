'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Brain, Loader2, Mail, Lock, ArrowLeft } from 'lucide-react'

type AuthMode = 'signin' | 'signup' | 'reset'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'

  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)

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
    if (!email.trim()) {
      toast.error('Please enter your email')
      return
    }
    if (mode !== 'reset' && !password) {
      toast.error('Please enter your password')
      return
    }

    setLoading(true)
    setNeedsConfirmation(false)

    const supabase = createClient()
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        })
        if (error) throw error

        if (data.user && data.user.identities && data.user.identities.length === 0) {
          // User already exists.
          toast.error('An account with this email already exists. Please sign in.')
          setMode('signin')
        } else if (data.session) {
          // Auto-confirmed (email confirmation disabled in Supabase).
          toast.success('Account created! Welcometo AdManager.')
          router.replace(next)
          router.refresh()
        } else {
          setNeedsConfirmation(true)
          toast.success('Account created! Check your email to confirm, then sign in.')
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
          if (error.message.toLowerCase().includes('email not confirmed')) {
            setNeedsConfirmation(true)
          }
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
    if (!email.trim()) {
      toast.error('Enter your email first')
      return
    }
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
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const subtitle =
    mode === 'signin'
      ? 'Sign in to your AI Ads brain'
      : mode === 'signup'
        ? 'Start automating your Meta Ads'
        : 'We will send you a reset link'

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="glass rounded-2xl p-8 space-y-6 card-3d">
          <div className="flex flex-col items-center gap-3 text-center">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-bg animate-gradient shadow-xl glow-md"
            >
              <Brain className="h-7 w-7 text-white" />
            </motion.div>
            <div>
              <h1 className="text-2xl font-bold gradient-text">AdManager</h1>
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="pl-9 glass border-border/50"
                  disabled={loading}
                />
              </div>
            </div>

            {mode !== 'reset' && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-9 glass border-border/50"
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {needsConfirmation && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                <p className="mb-2">Your email needs to be confirmed before you can sign in.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resendConfirmation}
                  disabled={loading}
                  className="w-full border-amber-500/30 text-amber-200 hover:bg-amber-500/20"
                >
                  Resend confirmation email
                </Button>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full gradient-bg animate-gradient shadow-lg card-3d"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Brain className="mr-2 h-4 w-4" />
              )}
              {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Sign up' : 'Send reset link'}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground space-y-2">
            {mode === 'signin' && (
              <>
                <div>
                  <button
                    type="button"
                    onClick={() => setMode('reset')}
                    className="text-primary font-medium hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div>
                  No account?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('signup')}
                    className="text-primary font-medium hover:underline"
                  >
                    Sign up
                  </button>
                </div>
              </>
            )}
            {mode === 'signup' && (
              <>
                <div>Already have an account?</div>
                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  className="text-primary font-medium hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
            {mode === 'reset' && (
              <button
                type="button"
                onClick={() => setMode('signin')}
                className="inline-flex items-center text-primary font-medium hover:underline"
              >
                <ArrowLeft className="mr-1 h-3 w-3" />
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
