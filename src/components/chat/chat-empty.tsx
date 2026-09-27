'use client'

import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Eye, ImageIcon, KeyRound, PenLine, TrendingUp, Zap, type LucideIcon } from 'lucide-react'
import { AiOrb } from './ai-orb'

const SUGGESTIONS: Array<{ icon: LucideIcon; title: string; prompt: string }> = [
  { icon: TrendingUp, title: 'How are my ads doing?', prompt: 'Show me my campaigns and how they are performing this month.' },
  { icon: PenLine, title: 'Write a new ad', prompt: 'Write a complete ad in my language, with an image.' },
  { icon: Eye, title: 'Review my latest creative', prompt: 'Review my latest ad creative and tell me what to improve.' },
  { icon: Zap, title: 'Check my setup', prompt: 'Test my Meta connection and tell me what is still missing before my first ad.' },
  { icon: ImageIcon, title: 'Make an ad image', prompt: 'Generate a square ad image for my best-selling product.' },
]

/** First screen of a new conversation: one clear focal point, then options. */
export function ChatEmpty({ onPick, name, needsKey = false }: { onPick: (prompt: string) => void; name?: string | null; needsKey?: boolean }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-8">
      <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-500 ease-out motion-reduce:animate-none">
        <AiOrb size={72} />
        <div className="ai-orb-shadow mt-2 w-14" aria-hidden="true" />
      </div>
      <h2 className="mt-6 text-balance text-center text-2xl font-semibold tracking-tight @2xl:text-[28px]">
        {name ? `What should we work on for ${name}?` : 'What should we work on today?'}
      </h2>
      <p className="mt-2 max-w-md text-center text-[15px] leading-relaxed text-muted-foreground">
        Plan campaigns, write ads in your language, check results, or ask anything about your Meta ads.
      </p>

      {needsKey && (
        <div role="status" className="mt-6 flex w-full flex-col gap-3 rounded-2xl border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/8 p-4 @md:flex-row @md:items-center">
          <KeyRound aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
          <p className="min-w-0 flex-1 text-sm leading-relaxed">
            <span className="font-semibold">Add an AI key to start.</span>{' '}
            <span className="text-muted-foreground">The AI Manager needs an OpenAI or Claude key. It takes a minute.</span>
          </p>
          <Link href="/settings" className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            Open Settings<ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      )}

      <ul className="mt-7 grid w-full grid-cols-1 gap-3 @xl:grid-cols-2">
        {SUGGESTIONS.map((s, i) => (
          <li
            key={s.title}
            className={`animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300 motion-reduce:animate-none ${i === SUGGESTIONS.length - 1 ? '@xl:col-span-2' : ''}`}
            style={{ animationDelay: `${120 + i * 45}ms` }}
          >
            <button
              type="button"
              onClick={() => onPick(s.prompt)}
              className="group flex h-full w-full min-w-0 items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left elev-1 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:elev-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,color-mix(in_oklch,var(--primary)_14%,transparent),color-mix(in_oklch,var(--gradient-end)_10%,transparent))] text-primary">
                <s.icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{s.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{s.prompt}</span>
              </span>
              <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
