'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
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
  Moon,
  Sun,
  Building2,
  Plug,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import { AiOrb } from '@/components/chat/ai-orb'

/**
 * Navigation.
 *
 * Previously every item carried its own gradient — nine different colours,
 * none of which meant anything. Colour that doesn't encode information trains
 * people to ignore colour, which matters here because elsewhere in this app
 * red genuinely means "you are over budget".
 *
 * So: one accent, used only to mark where you are. Items are grouped by what
 * the client is trying to do rather than listed flat, and the two setup
 * destinations sit at the bottom where they belong after day one.
 */

const NAV_GROUPS: Array<{
  label: string
  items: Array<{ href: string; label: string; icon: typeof LayoutDashboard; badge?: string }>
}> = [
  {
    label: 'Run',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/ai-manager', label: 'AI Manager', icon: Sparkles, badge: 'AI' },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/creatives', label: 'Ad Creatives', icon: ImagePlus },
      { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
      { href: '/schedule', label: 'Automations', icon: CalendarClock },
    ],
  },
  {
    label: 'Money',
    items: [{ href: '/budget', label: 'Budget & Bills', icon: Wallet }],
  },
  {
    label: 'Setup',
    items: [
      { href: '/business', label: 'Business Profile', icon: Building2 },
      { href: '/connect', label: 'Meta Connection', icon: Link2 },
      { href: '/connections', label: 'Connections', icon: Plug },
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/profile', label: 'Account', icon: User },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (pathname === '/login' || pathname?.startsWith('/auth/')) return null

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <>
      <button
        type="button"
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm md:hidden"
        onClick={() => setMobileOpen((open) => !open)}
        aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={mobileOpen}
        aria-controls="primary-navigation"
      >
        {mobileOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Sidebar"
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar bg-[radial-gradient(120%_40%_at_0%_0%,color-mix(in_oklch,var(--sidebar-primary)_16%,transparent),transparent_70%)] transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
          <AiOrb size={34} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">AdManager</p>
            <p className="truncate text-xs text-sidebar-foreground/70">Meta Ads, run by AI</p>
          </div>
        </div>

        <nav id="primary-navigation" aria-label="Main navigation" className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-5 last:mb-0">
              <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/65">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'group relative flex min-h-9 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                          isActive
                            ? 'bg-[linear-gradient(90deg,color-mix(in_oklch,var(--sidebar-primary)_24%,transparent),color-mix(in_oklch,var(--sidebar-primary)_6%,transparent))] font-medium text-sidebar-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--sidebar-primary)_25%,transparent)]'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                        )}
                      >
                        {/* One accent, one job: marking where you are. */}
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-sidebar-primary"
                          />
                        )}
                        {item.href === '/ai-manager'
                          ? <AiOrb size={16} />
                          : <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
                        <span className="flex-1 truncate">{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-1 border-t border-sidebar-border p-3">
          <ThemeToggle />
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSignOut}
            className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  // Both icons are always in the DOM and CSS picks which one shows. Branching
  // on the resolved theme during render would mismatch the server output,
  // which is the only reason this component previously needed a mounted flag.
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      aria-label="Toggle between light and dark theme"
    >
      <Moon aria-hidden="true" className="h-3.5 w-3.5 dark:hidden" />
      <Sun aria-hidden="true" className="hidden h-3.5 w-3.5 dark:block" />
      <span className="dark:hidden">Dark</span>
      <span className="hidden dark:inline">Light</span>
    </button>
  )
}
