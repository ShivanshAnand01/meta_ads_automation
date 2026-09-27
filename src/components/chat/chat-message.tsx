'use client'

import { memo, useMemo, useState } from 'react'
import Image from 'next/image'
import { Check, Copy, Paperclip } from 'lucide-react'
import { AiOrb } from './ai-orb'
import { Markdown } from './markdown'
import { ToolSteps, InlineImages } from './tool-steps'
import type { ChatMessage } from './types'

/** Remove the "[Attached: …]" suffix the server appends for the model. */
export function displayUserContent(content: string): string {
  const idx = content.indexOf('\n\n[Attached:')
  return idx > 0 ? content.slice(0, idx) : content
}

/**
 * Strip accidental tool-execution artifacts from assistant markdown so the
 * owner only sees conversation. The stored message is untouched.
 *
 * Fenced code blocks are left alone: the "raw JSON line" rule used to empty
 * every legitimate JSON example the agent showed.
 */
export function cleanAssistantContent(content: string): string {
  if (!content) return ''
  const parts = content.split(/(```[\s\S]*?(?:```|$))/g)
  return parts
    .map((part, i) => (i % 2 === 1 ? part : part
      .replace(/\{\{\{?[\s\S]*?\}\}\}?/g, '')
      .replace(/^\s*\{[\s\S]*?\}\s*$/gm, '')
      .replace(/^\s*("results?"|"user"|"tool"|"arguments?"|"status"|"data")\s*[:=].*$/gim, '')))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function timeLabel(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export function ThinkingLine({ phase }: { phase?: string }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 py-1 text-sm font-medium">
      <span className="text-shimmer">{phase === 'analyzing' ? 'Analysing the results' : 'Thinking'}</span>
    </p>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch {}
      }}
      aria-label={copied ? 'Copied' : 'Copy reply'}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/msg:opacity-100 [@media(hover:none)]:opacity-100"
    >
      {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function UserMessage({ msg }: { msg: ChatMessage }) {
  const time = timeLabel(msg.createdAt)
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2 pr-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">You</span>
        {time && <time dateTime={msg.createdAt}>{time}</time>}
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-[linear-gradient(135deg,var(--gradient-start),var(--gradient-mid))] px-4 py-2.5 text-[15px] leading-relaxed text-white elev-2 sm:max-w-[75%]">
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{displayUserContent(msg.content)}</p>
      </div>
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {msg.attachments.map((att, j) => (
            <div key={j} className="overflow-hidden rounded-xl border border-border bg-card elev-1">
              {att.type.startsWith('image/') ? (
                <Image src={att.url} alt={att.name} width={72} height={72} className="h-[72px] w-[72px] object-cover" />
              ) : (
                <div className="flex h-[72px] w-40 items-center gap-2 px-3">
                  <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs text-muted-foreground" title={att.name}>{att.name}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AssistantMessage({ msg }: { msg: ChatMessage }) {
  const text = useMemo(() => cleanAssistantContent(msg.content), [msg.content])
  const tools = msg.toolCalls ?? []
  const time = timeLabel(msg.createdAt)
  const working = Boolean(msg.streaming)

  return (
    <div className="group/msg flex gap-3">
      <AiOrb size={28} working={working} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        {/* The layer above the message: who, when, and what state. */}
        <div className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
          <span className="text-[13px] font-semibold text-foreground">AI Manager</span>
          {time && <time dateTime={msg.createdAt}>{time}</time>}
          {working && <span className="sr-only">is working</span>}
        </div>

        {msg.thinking && !text && tools.length === 0 && <ThinkingLine phase={msg.thinkingPhase} />}

        {tools.length > 0 && <ToolSteps toolCalls={tools} />}

        {text && (
          <div className="relative">
            <Markdown content={text} streaming={msg.streaming} />
            {msg.streaming && !msg.thinking && (
              <span aria-hidden="true" className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-pulse rounded-full bg-primary align-baseline" />
            )}
          </div>
        )}

        {tools.length > 0 && !msg.streaming && <InlineImages toolCalls={tools} />}

        {msg.thinking && (text || tools.length > 0) && <ThinkingLine phase={msg.thinkingPhase} />}

        {!msg.streaming && text && (
          <div className="-ml-2 flex items-center gap-1 pt-0.5">
            <CopyButton text={text} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One row of the conversation. Memoised: while a reply streams, only the
 * streaming message's object changes, so every earlier row skips rendering.
 */
export const MessageRow = memo(function MessageRow({ msg, animate }: { msg: ChatMessage; animate: boolean }) {
  return (
    <div className={`chat-row ${animate ? 'animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none' : ''}`}>
      {msg.role === 'user' ? <UserMessage msg={msg} /> : <AssistantMessage msg={msg} />}
    </div>
  )
})
