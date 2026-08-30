'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ImagePlus,
  Megaphone,
  CalendarClock,
  Wallet,
  Settings,
  Link2,
  Menu,
  X,
  Sparkles,
  LogOut,
  User,
} from 'lucide-react'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  {
    href: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    desc: 'Overview & stats',
    color: 'from-violet-500 to-purple-600',
  },
  {
    href: '/ai-manager',
    label: 'AI Manager',
    icon: Sparkles,
    desc: 'Talk to AI brain',
    badge: 'AI',
    color: 'from-fuchsia-500 to-pink-600',
  },
  {
    href: '/creatives',
    label: 'Ad Creatives',
    icon: ImagePlus,
    desc: 'Create & review',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    href: '/campaigns',
    label: 'Campaigns',
    icon: Megaphone,
    desc: 'Manage campaigns',
    color: 'from-emerald-500 to-teal-600',
  },
  {
    href: '/schedule',
    label: 'Schedule',
    icon: CalendarClock,
    desc: 'Automate tasks',
    color: 'from-amber-500 to-orange-600',
  },
  {
    href: '/budget',
    label: 'Budget & Bills',
    icon: Wallet,
    desc: 'Spend & billing',
    color: 'from-rose-500 to-red-600',
  },
  {
    href: '/connect',
    label: 'Meta Connection',
    icon: Link2,
    desc: 'Connect account',
    color: 'from-indigo-500 to-blue-600',
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: User,
    desc: 'Identity & connection health',
    color: 'from-cyan-500 to-teal-600',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    desc: 'AI & app config',
    color: 'from-slate-500 to-slate-700',
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Hide the sidebar on public auth pages. During static generation pathname is
  // null; we default to visible and let client hydration correct it.
  if (pathname === '/login' || pathname?.startsWith('/auth/')) return null

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <>
      {/* Mobile menu button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed left-4 top-4 z-50 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-xl md:hidden"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={mobileOpen}
        aria-controls="primary-navigation"
      >
        <AnimatePresence mode="wait">
          {mobileOpen ? (
            <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X className="h-5 w-5" />
            </motion.div>
          ) : (
            <motion.div key="menu" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
              <Menu className="h-5 w-5" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        aria-label="Sidebar"
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-[270px] flex-col transition-transform duration-300',
          'bg-gradient-to-b from-[#1a1625] via-[#15121f] to-[#100d18]',
          'border-r border-white/[0.06]',
          'shadow-[4px_0_24px_-4px_rgba(0,0,0,0.4)]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Logo section */}
        <div className="relative flex items-center gap-3 px-6 py-5 border-b border-white/[0.06]">
          {/* Subtle glow behind logo */}
          <div className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-violet-500/20 blur-xl" />
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
            className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 shadow-lg shadow-violet-500/30"
          >
            <Sparkles className="h-5 w-5 text-white" />
          </motion.div>
          <div className="relative">
            <h1 className="text-lg font-bold bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-300 bg-clip-text text-transparent">
              AdManager
            </h1>
            <p className="text-[11px] text-white/65 font-medium tracking-wide">META ADS PLATFORM</p>
          </div>
        </div>

        {/* Navigation */}
        <nav id="primary-navigation" aria-label="Main navigation" className="flex-1 space-y-1.5 overflow-y-auto scrollbar-thin px-3 py-4">
          {navItems.map((item, index) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <motion.div
                key={item.href}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 + 0.1 }}
              >
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-3 transition-all duration-200',
                    isActive
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/70 hover:text-white/90 hover:bg-white/[0.04]'
                  )}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <motion.div
                      layoutId="active-nav-bar"
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 rounded-r-full bg-gradient-to-b from-violet-400 to-fuchsia-500"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}

                  {/* Icon with gradient on active */}
                  <div className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 shrink-0',
                    isActive
                      ? `bg-gradient-to-br ${item.color} shadow-md`
                      : 'bg-white/[0.05] group-hover:bg-white/[0.08]'
                  )}>
                    <Icon aria-hidden="true" className={cn('h-4 w-4', isActive ? 'text-white' : 'text-white/70 group-hover:text-white')} />
                  </div>

                  {/* Label and description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{item.label}</span>
                      {item.badge && (
                        <span className="rounded-md bg-gradient-to-r from-fuchsia-500/30 to-pink-500/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-fuchsia-300 ring-1 ring-fuchsia-500/20">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      'text-[11px] mt-0.5 transition-colors',
                      isActive ? 'text-white/60' : 'text-white/60'
                    )}>
                      {item.desc}
                    </p>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </nav>

        {/* Bottom status section */}
        <div className="border-t border-white/[0.06] p-3 space-y-2">
          <div className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-2.5 w-2.5">
                <span aria-hidden="true" className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-white/80">System Active</p>
                <p className="text-[10px] text-white/65">Platform online</p>
              </div>
              <button
                onClick={handleSignOut}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white transition-colors"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          <p className="text-[10px] text-white/60 text-center font-medium tracking-wider uppercase">
            Built for Maharashtrian Market
          </p>
        </div>
      </motion.aside>
    </>
  )
}
