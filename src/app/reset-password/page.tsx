'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { AiOrb } from '@/components/chat/ai-orb'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Loader2, Lock } from 'lucide-react'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    // A password reset is only legitimate when the session comes from a recovery
    // link. Supabase emits PASSWORD_RECOVERY on the auth state change channel;
    // we wait briefly for it before rejecting the page.
    let recovered = false
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovered = true
        setChecking(false)
      }
    })

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error || !session) {
        toast.error('Reset link expired or invalid. Please request a new one.')
        router.replace('/login?error=reset_expired')
        return
      }
      // If we already saw PASSWORD_RECOVERY, we're done. Otherwise give the
      // event a short window to fire (it usually fires immediately).
      if (recovered) return
      setTimeout(() => {
        if (!recovered) {
          toast.error('Reset link expired or invalid. Please request a new one.')
          router.replace('/login?error=reset_expired')
        }
      }, 500)
    })

    return () => subscription.unsubscribe()
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Same rule as sign-up, so a reset cannot set a weaker password.
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      toast.error('Passwords do not match')
      return
    }

    setLoading(true)
    const supabase = createClient()
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast.success('Password updated! Redirecting to dashboard...')
      router.replace('/')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password')
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

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_40%_at_50%_20%,color-mix(in_oklch,var(--gradient-mid)_16%,transparent),transparent_70%)]" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-sm"
      >
        <div className="space-y-6 rounded-2xl border border-border bg-card p-6 elev-2 sm:p-7">
          <div className="flex flex-col items-center gap-3 text-center">
            <AiOrb size={56} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Set new password</h1>
              <p className="text-sm text-muted-foreground mt-1">Enter your new password below</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Lock aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="pl-9 h-11"
                  disabled={loading}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <div className="relative">
                <Lock aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="confirm"
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9 h-11"
                  disabled={loading}
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Update password
            </Button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}
