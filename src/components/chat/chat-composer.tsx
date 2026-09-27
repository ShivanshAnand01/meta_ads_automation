'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { ArrowUp, Loader2, Paperclip, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PendingAttachment {
  id: string
  url: string
  type: string
  name: string
  documentId?: string
  loading?: boolean
}

/**
 * The message box: floating, auto-growing, with attachments inside it. Enter
 * sends, Shift+Enter adds a line. While a reply streams the send button
 * becomes Stop in the same place, so the hand never has to move.
 */
export function ChatComposer({
  value, onChange, onSend, onStop, onAttach, onRemoveAttachment,
  attachments, sending, uploading, disabled, modelLabel, focusToken = 0,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  onAttach: (file: File) => void
  onRemoveAttachment: (id: string) => void
  attachments: PendingAttachment[]
  sending: boolean
  uploading: boolean
  disabled: boolean
  modelLabel: string | null
  /** Bump to move the cursor into the box (e.g. after picking a suggestion). */
  focusToken?: number
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const canSend = !disabled && !sending && (value.trim().length > 0 || attachments.some((a) => !a.loading))

  useEffect(() => {
    if (!focusToken) return
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [focusToken])

  // Grow with the text up to a cap, without a layout library.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    // Empty: let CSS decide. Chrome counts a wrapped placeholder in
    // scrollHeight, which made the empty box 200px tall on narrow screens.
    if (!value) { el.style.height = ''; return }
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  return (
    <div className="px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
      <div
        className={cn(
          'mx-auto w-full max-w-3xl rounded-2xl border border-border bg-card elev-2 transition-[border-color,box-shadow] duration-200',
          'focus-within:border-primary/50 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_12%,transparent),0_8px_24px_-6px_oklch(0.2_0.02_260/0.12)]',
        )}
      >
        {attachments.length > 0 && (
          <ul aria-label="Attachments" className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((att) => (
              <li key={att.id} className="group relative overflow-hidden rounded-xl border border-border bg-muted/40">
                {att.loading ? (
                  <div className="flex h-14 w-40 items-center gap-2 px-3">
                    <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    <span className="truncate text-xs text-muted-foreground">Reading {att.name}…</span>
                  </div>
                ) : att.type.startsWith('image/') ? (
                  <Image src={att.url} alt={att.name} width={56} height={56} className="h-14 w-14 object-cover" />
                ) : (
                  <div className="flex h-14 w-40 items-center gap-2 px-3">
                    <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs" title={att.name}>{att.name}</span>
                  </div>
                )}
                {!att.loading && (
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(att.id)}
                    aria-label={`Remove ${att.name}`}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/75 text-background opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={areaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend) onSend()
            }
          }}
          rows={1}
          disabled={disabled}
          aria-label="Message the AI Manager"
          placeholder={disabled ? 'Add an AI key in Settings to start' : 'Ask anything about your ads…'}
          className="block max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed placeholder:text-muted-foreground/80 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,.txt,.csv,.json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = '' }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || sending || disabled}
            aria-label="Attach an image or document"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {uploading ? <Loader2 aria-hidden="true" className="h-[18px] w-[18px] animate-spin" /> : <Paperclip aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />}
          </button>
          {modelLabel && (
            <span className="hidden truncate rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground @xl:inline">{modelLabel}</span>
          )}
          <span className="ml-auto hidden text-xs text-muted-foreground @3xl:inline">
            <kbd className="font-sans font-medium text-foreground/70">Enter</kbd> to send · <kbd className="font-sans font-medium text-foreground/70">Shift + Enter</kbd> new line
          </span>
          {sending ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 @3xl:ml-2"
            >
              <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send message"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--gradient-start),var(--gradient-mid))] text-white shadow-[0_4px_12px_-2px_oklch(0.52_0.22_264/0.45)] transition-[transform,opacity,box-shadow] duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:scale-100 disabled:opacity-35 disabled:shadow-none @3xl:ml-2"
            >
              <ArrowUp aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
