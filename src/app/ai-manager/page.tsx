'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { StatusPill, type StatusTone } from '@/components/ui/metric'
import { MODEL_PRESETS } from '@/lib/ai/model-catalog'
import { AiOrb } from '@/components/chat/ai-orb'
import { MessageRow } from '@/components/chat/chat-message'
import { ChatComposer, type PendingAttachment } from '@/components/chat/chat-composer'
import { ChatEmpty } from '@/components/chat/chat-empty'
import type { ChatMessage as Message, ToolCallInfo } from '@/components/chat/types'
import {
  Send, Loader2, StickyNote, Plus, Trash2, Sparkles, Cpu, Key, Server,
  BookOpen, Upload, ShieldAlert, ArrowDown, PanelRight, MessagesSquare,
} from 'lucide-react'

/*
 * AI Manager: the conversation with the agent.
 *
 * Performance notes, because "it feels slow" was the complaint:
 * - Streamed text is buffered and applied once per animation frame, not once
 *   per token. A fast model sends dozens of tokens a frame.
 * - Each message is a memoised row; only the one being streamed re-renders.
 * - Markdown skips syntax highlighting until a message is complete.
 * - Off-screen rows skip layout and paint (content-visibility).
 * - Charts load on demand; recharts is no longer in this page's bundle.
 */

interface Note {
  id: string
  title: string
  content: string
  type: string
  createdAt: string
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  notes: Note[]
  createdAt: string
  updatedAt: string
}

interface BrainConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  configured: boolean
  embeddingKey?: string
}

type RawMessage = {
  id?: string
  role: string
  content: string
  toolCalls?: string | unknown[]
  toolResults?: string | unknown[]
  createdAt?: string
}

type RawConversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  notes?: Note[]
  messages?: RawMessage[]
}

const providerInfo = {
  anthropic: { name: 'Claude (Anthropic)', icon: Sparkles, needsApiKey: true, needsBaseUrl: false, defaultBaseUrl: '', defaultModel: 'claude-sonnet-5' },
  ollama: { name: 'Ollama (Local)', icon: Cpu, needsApiKey: false, needsBaseUrl: true, defaultBaseUrl: 'http://localhost:11434', defaultModel: 'llama3' },
  openai: { name: 'OpenAI GPT', icon: Key, needsApiKey: true, needsBaseUrl: false, defaultBaseUrl: '', defaultModel: 'gpt-5.4-mini' },
  groq: { name: 'Groq', icon: Server, needsApiKey: true, needsBaseUrl: false, defaultBaseUrl: '', defaultModel: 'llama-3.3-70b-versatile' },
}

function safeParseArray(s: string | null | undefined): unknown[] {
  if (!s) return []
  try { return JSON.parse(s) } catch { return [] }
}

function modelLabelOf(b: BrainConfig | null): string | null {
  if (!b) return null
  return MODEL_PRESETS[b.provider]?.find((m) => m.value === b.model)?.label || b.model
}

interface Approval {
  id: string
  toolName: string
  summary: string
  risk: string
  status: string
  createdAt: string
}

const RISK_TONE: Record<string, { tone: StatusTone; label: string }> = {
  high: { tone: 'critical', label: 'High risk' },
  medium: { tone: 'warning', label: 'Medium risk' },
  low: { tone: 'good', label: 'Low risk' },
}

function humanizeTool(name: string): string {
  const t = name.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function ApprovalCard({ approval, onDecision, busy }: { approval: { id: string; toolName: string; summary: string; risk: string }; onDecision: (id: string, decision: 'approve' | 'reject') => void; busy: boolean }) {
  const risk = RISK_TONE[approval.risk] ?? RISK_TONE.high
  return (
    <div className="space-y-2.5 rounded-xl border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <span className="min-w-0 text-sm font-medium">{humanizeTool(approval.toolName)}</span>
        <StatusPill tone={risk.tone} className="ml-auto">{risk.label}</StatusPill>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{approval.summary}</p>
      <div className="flex gap-2">
        <Button size="sm" className="h-9" disabled={busy} onClick={() => onDecision(approval.id, 'approve')}>
          Approve and run
        </Button>
        <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => onDecision(approval.id, 'reject')}>
          Reject
        </Button>
      </div>
    </div>
  )
}

function relativeDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days <= 0 && d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  if (days <= 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString('en-IN', { weekday: 'short' })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Chats, approvals and notes in one panel: a rail on desktop, a sheet on phones. */
function SidePanel({
  conversations, activeId, onOpen, onDelete, approvals, approvalBusy, onDecision, notes, tab, onTab,
}: {
  conversations: Conversation[]
  activeId: string | null
  onOpen: (c: Conversation) => void
  onDelete: (id: string) => void
  approvals: Approval[]
  approvalBusy: string | null
  onDecision: (id: string, d: 'approve' | 'reject') => void
  notes: Note[]
  tab: string
  onTab: (t: string) => void
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(String(v))} className="flex h-full min-h-0 flex-col gap-0">
      <div className="border-b border-border px-3 pb-2.5 pt-3">
        <TabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="chats" className="text-[13px]">Chats</TabsTrigger>
          <TabsTrigger value="approvals" className="text-[13px]">
            Approvals
            {approvals.length > 0 && (
              <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--status-warning)] px-1 text-[11px] font-semibold text-amber-950 tabular">
                {approvals.length}<span className="sr-only"> waiting</span>
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="notes" className="text-[13px]">Notes</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="chats" className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        {conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">Your conversations will appear here.</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => {
              const active = activeId === c.id
              return (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onOpen(c)}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full min-w-0 flex-col gap-0.5 rounded-xl py-2.5 pl-3 pr-11 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active ? 'bg-primary/10' : 'hover:bg-muted'
                    }`}
                  >
                    <span className={`truncate text-[13px] font-medium ${active ? 'text-primary' : 'text-foreground'}`}>{c.title || 'Untitled chat'}</span>
                    <span className="text-xs text-muted-foreground">{relativeDay(c.updatedAt || c.createdAt)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation: ${c.title}`}
                    onClick={() => onDelete(c.id)}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--status-critical)]/10 hover:text-[var(--status-critical-ink)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="approvals" className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 scrollbar-thin">
        {approvals.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <ShieldAlert aria-hidden="true" className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Nothing waiting</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Anything that would change live ad spend waits here for your yes.</p>
          </div>
        ) : approvals.map((a) => (
          <ApprovalCard key={a.id} approval={a} busy={approvalBusy === a.id} onDecision={onDecision} />
        ))}
      </TabsContent>

      <TabsContent value="notes" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 scrollbar-thin">
        {notes.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <StickyNote aria-hidden="true" className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No notes yet</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">The agent pins findings and reminders here as it works.</p>
          </div>
        ) : notes.map((note) => (
          <article key={note.id} className="rounded-xl border border-border bg-card p-3 elev-1">
            <h3 className="text-[13px] font-semibold">{note.title}</h3>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">{note.content}</p>
          </article>
        ))}
      </TabsContent>
    </Tabs>
  )
}

/** Respect the OS "reduce motion" setting (CSS handles every animation here). */
export default function AIManagerPage() {
  return <AIManagerPageInner />
}

function AIManagerPageInner() {
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [brain, setBrain] = useState<BrainConfig | null>(null)
  const [brainLoaded, setBrainLoaded] = useState(false)
  const [showBrainDialog, setShowBrainDialog] = useState(false)
  const [showPanelSheet, setShowPanelSheet] = useState(false)
  const [showKBDialog, setShowKBDialog] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [abortRef, setAbortRef] = useState<AbortController | null>(null)
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState('chats')
  const [animateFrom, setAnimateFrom] = useState(0)
  const [focusToken, setFocusToken] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const autoScrollRef = useRef(true)
  useEffect(() => { autoScrollRef.current = autoScroll }, [autoScroll])
  // Pin to the bottom only while something is arriving: a streaming reply,
  // or a just-opened conversation whose images are still loading. Pinning
  // at any other time yanked the view away when someone expanded a step.
  const sendingRef = useRef(false)
  const pinUntilRef = useRef(0)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [activeQuestion, setActiveQuestion] = useState<{ questionId: string; question: string; placeholder: string } | null>(null)
  const [questionAnswer, setQuestionAnswer] = useState('')
  const [submittingAnswer, setSubmittingAnswer] = useState(false)

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-manager/approvals')
      const json = await res.json()
      if (json.approvals) setApprovals(json.approvals as Approval[])
    } catch {}
  }, [])

  // Open on the approvals tab when something is waiting.
  const approvalsSeen = useRef(false)
  useEffect(() => {
    if (!approvalsSeen.current && approvals.length > 0) {
      approvalsSeen.current = true
      setPanelTab('approvals')
    }
  }, [approvals.length])

  async function handleApprovalDecision(id: string, decision: 'approve' | 'reject') {
    setApprovalBusy(id)
    try {
      const res = await fetch('/api/ai-manager/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId: id, decision }),
      })
      const json = await res.json()
      if (res.ok && json.status === 'failed') {
        // It ran, but did not work — say what went wrong instead of "done".
        const why = json.result?.message || json.result?.error || 'The action did not succeed.'
        toast.error(`Approved, but it failed: ${why}`, { duration: 12000 })
        setApprovals((prev) => prev.filter((a) => a.id !== id))
      } else if (res.ok) {
        toast.success(decision === 'approve' ? 'Approved and run' : 'Rejected')
        setApprovals((prev) => prev.filter((a) => a.id !== id))
      } else {
        toast.error(json.error || 'Failed')
      }
    } catch {
      toast.error('Failed to process approval')
    } finally {
      setApprovalBusy(null)
    }
  }

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distanceFromBottom < 120
    setAutoScroll(nearBottom)
    setShowScrollButton(!nearBottom && el.scrollHeight > el.clientHeight + 120)
  }, [])

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    setAutoScroll(true)
    setShowScrollButton(false)
  }, [])

  // Stay pinned to the newest message while the reader is at the bottom.
  // Content keeps growing after a render (streamed text, images loading,
  // off-screen rows getting their real height), so watch its size rather
  // than scrolling once and hoping.
  useEffect(() => {
    const content = contentRef.current
    const scroller = scrollContainerRef.current
    if (!content || !scroller) return
    pinUntilRef.current = Date.now() + 1500
    const ro = new ResizeObserver(() => {
      const arriving = sendingRef.current || Date.now() < pinUntilRef.current
      if (arriving && autoScrollRef.current) scroller.scrollTop = scroller.scrollHeight
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [activeConversation?.id])

  // Follow the reply as it streams, once per frame at most.
  const messageCount = activeConversation?.messages.length ?? 0
  useEffect(() => {
    // Nothing to follow on the empty screen; scrolling it clipped the orb.
    if (!autoScroll || messageCount === 0) return
    const id = requestAnimationFrame(() => {
      const el = scrollContainerRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [activeConversation?.messages, autoScroll, messageCount])

  function normalizeConversation(c: RawConversation): Conversation {
    return {
      ...c,
      notes: c.notes || [],
      messages: (c.messages || []).map((m: RawMessage) => ({
        ...m,
        role: m.role as 'user' | 'assistant',
        toolCalls: (typeof m.toolCalls === 'string'
          ? safeParseArray(m.toolCalls)
          : m.toolCalls || []) as ToolCallInfo[],
      })),
    }
  }

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-manager/conversations')
      const json = await res.json()
      if (json.conversations) {
        const normalized = json.conversations.map((c: RawConversation) => normalizeConversation(c))
        setConversations(normalized)
      }
    } catch {}
  }, [])

  const fetchBrain = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai')
      const json = await res.json()
      if (json.provider) {
        setBrain({
          provider: json.provider,
          model: json.model,
          apiKey: json.apiKey || '',
          baseUrl: json.baseUrl || '',
          configured: true,
        })
      } else {
        setBrain(null)
      }
    } catch {} finally {
      setBrainLoaded(true)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConversations()
    fetchBrain()
    fetchApprovals()
  }, [fetchConversations, fetchBrain, fetchApprovals])

  const isVectorizableDoc = (type: string) =>
    type === 'application/pdf' || type === 'text/plain' || type === 'text/csv' || type === 'application/json'

  async function handleFileUpload(file: File) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large (max 10MB)')
      return
    }

    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const isDoc = isVectorizableDoc(file.type)

    if (isDoc) {
      setPendingAttachments((prev) => [...prev, { id: tempId, url: '', type: file.type, name: file.name, loading: true }])
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/knowledge-base', { method: 'POST', body: formData })
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to read the file')
        setPendingAttachments((prev) =>
          prev.map((att) =>
            att.id === tempId
              ? { id: tempId, url: json.url || '', type: file.type, name: file.name, documentId: json.documentId, loading: false }
              : att
          )
        )
        toast.success(json.chunkCount ? `Read ${file.name} (${json.chunkCount} sections)` : `Stored ${file.name}`)
      } catch (err) {
        setPendingAttachments((prev) => prev.filter((att) => att.id !== tempId))
        toast.error(err instanceof Error ? err.message : 'Failed to read the file')
      } finally {
        setUploading(false)
      }
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('bucket', 'chat-attachments')
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed')
      setPendingAttachments((prev) => [...prev, { id: tempId, url: json.url, type: json.fileType, name: json.fileName }])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const updateLastAssistant = useCallback((fn: (m: Message) => Message) => {
    setActiveConversation((prev) => {
      if (!prev) return prev
      const msgs = [...prev.messages]
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant' && msgs[i].streaming) {
          msgs[i] = fn(msgs[i])
          break
        }
      }
      return { ...prev, messages: msgs }
    })
  }, [])

  async function sendMessage() {
    if ((!input.trim() && pendingAttachments.length === 0) || sending) return
    if (!brain?.configured) {
      toast.error('Configure your AI brain first')
      setShowBrainDialog(true)
      return
    }

    const message = input.trim() || (pendingAttachments.length > 0 ? 'Please analyze the attached image(s) and provide recommendations.' : '')
    setInput('')
    const attachments = pendingAttachments.filter((a) => !a.loading).map(({ url, type, name }) => ({ url, type, name }))
    setPendingAttachments([])
    setAutoScroll(true)
    autoScrollRef.current = true
    setSending(true)
    sendingRef.current = true

    const controller = new AbortController()
    setAbortRef(controller)

    const existingId = activeConversation && activeConversation.id !== 'temp' ? activeConversation.id : null
    const now = new Date().toISOString()
    const placeholder: Message = {
      role: 'assistant', content: '', streaming: true, thinking: true, thinkingPhase: 'reasoning', toolCalls: [], createdAt: now,
    }

    const baseMessages: Message[] = existingId ? [...activeConversation!.messages] : []
    baseMessages.push({ role: 'user', content: message, attachments: attachments.length > 0 ? attachments : undefined, createdAt: now })
    baseMessages.push(placeholder)

    const conv: Conversation = existingId
      ? { ...activeConversation!, messages: baseMessages }
      : { id: 'temp', title: message.slice(0, 50), messages: baseMessages, notes: [], createdAt: now, updatedAt: now }
    setActiveConversation(conv)

    // Tokens arrive far faster than the screen refreshes. Collect them and
    // apply once per frame; flush before any other event so order holds.
    let pendingText = ''
    let frame = 0
    const flushText = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      if (!pendingText) return
      const chunk = pendingText
      pendingText = ''
      updateLastAssistant((m) => ({ ...m, content: m.content + chunk, thinking: false }))
    }

    try {
      const res = await fetch('/api/ai-manager/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversationId: existingId ?? undefined, attachments: attachments.length > 0 ? attachments : undefined }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to send message')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const eventStr of events) {
          const line = eventStr.trim()
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data) continue
          try {
            const ev = JSON.parse(data)
            if (ev.t === 'text') {
              pendingText += ev.v
              if (!frame) frame = requestAnimationFrame(() => { frame = 0; flushText() })
              continue
            }
            flushText()

            if (ev.t === 'init') {
              setActiveConversation((prev) => prev && prev.id === 'temp' ? { ...prev, id: ev.conversationId } : prev)
            } else if (ev.t === 'thinking') {
              updateLastAssistant((m) => ({ ...m, thinking: true, thinkingPhase: ev.phase }))
            } else if (ev.t === 'tool_call') {
              updateLastAssistant((m) => ({
                ...m,
                thinking: false,
                toolCalls: [...(m.toolCalls || []), {
                  id: ev.toolCall.id,
                  name: ev.toolCall.name,
                  arguments: ev.toolCall.arguments,
                  status: 'pending',
                }],
              }))
            } else if (ev.t === 'tool_result') {
              updateLastAssistant((m) => ({
                ...m,
                toolCalls: (m.toolCalls || []).map((tc) =>
                  tc.id === ev.toolCallId
                    ? { ...tc, result: ev.result, error: ev.error, status: ev.error ? 'error' as const : 'done' as const }
                    : tc
                ),
              }))
            } else if (ev.t === 'note') {
              setNotes((prev) => [...prev, { ...ev.note, id: crypto.randomUUID(), createdAt: new Date().toISOString() }])
            } else if (ev.t === 'question') {
              setActiveQuestion({ questionId: ev.questionId, question: ev.question, placeholder: ev.placeholder || '' })
              setQuestionAnswer('')
            } else if (ev.t === 'done') {
              updateLastAssistant((m) => ({ ...m, streaming: false, thinking: false }))
            } else if (ev.t === 'error') {
              toast.error(ev.error)
              updateLastAssistant((m) => ({ ...m, streaming: false, thinking: false }))
            }
          } catch {}
        }
      }

      flushText()
      updateLastAssistant((m) => ({ ...m, streaming: false, thinking: false }))
    } catch (err) {
      flushText()
      if (err instanceof Error && err.name === 'AbortError') {
        updateLastAssistant((m) => ({ ...m, streaming: false, thinking: false }))
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to send message')
        updateLastAssistant((m) => ({ ...m, streaming: false, thinking: false, content: m.content || 'Failed to generate response.' }))
      }
    } finally {
      setSending(false)
      sendingRef.current = false
      setAbortRef(null)
      fetchConversations()
      fetchApprovals()
    }
  }

  function stopSending() {
    abortRef?.abort()
  }

  async function submitQuestionAnswer() {
    if (!activeQuestion || !questionAnswer.trim() || submittingAnswer) return
    setSubmittingAnswer(true)
    try {
      const res = await fetch('/api/ai-manager/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: activeQuestion.questionId, answer: questionAnswer.trim() }),
      })
      if (!res.ok) {
        toast.error('Failed to submit answer')
      }
    } catch {
      toast.error('Failed to submit answer')
    } finally {
      setSubmittingAnswer(false)
      setActiveQuestion(null)
      setQuestionAnswer('')
    }
  }

  function skipQuestion() {
    if (!activeQuestion) return
    fetch('/api/ai-manager/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: activeQuestion.questionId, answer: '' }),
    }).catch(() => {})
    setActiveQuestion(null)
    setQuestionAnswer('')
  }

  function newConversation() {
    setActiveConversation(null)
    setNotes([])
    setAnimateFrom(0)
    setFocusToken((t) => t + 1)
  }

  function openConversation(c: Conversation) {
    setActiveConversation(c)
    setNotes(c.notes || [])
    // History appears at once; only messages added from now on animate in.
    setAnimateFrom(c.messages.length)
    setAutoScroll(true)
    setShowPanelSheet(false)
  }

  async function deleteConversation(id: string) {
    try {
      await fetch(`/api/ai-manager/conversations?id=${id}`, { method: 'DELETE' })
      fetchConversations()
      if (activeConversation?.id === id) setActiveConversation(null)
    } catch {}
  }

  async function saveBrain(config: BrainConfig) {
    try {
      // Only send provider + model. Never send apiKey/baseUrl/embeddingKey from
      // here — those live in Settings. Sending them (even empty) would clear
      // the stored API key via the upsert.
      const res = await fetch('/api/settings/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: config.provider, model: config.model }),
      })
      if (res.ok) {
        toast.success('Model saved')
        setBrain((prev) => (prev ? { ...prev, model: config.model } : { ...config, configured: true }))
        setShowBrainDialog(false)
      } else {
        const json = await res.json()
        toast.error(json.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save settings')
    }
  }

  const messages = activeConversation?.messages ?? []
  const isEmpty = messages.length === 0
  const modelLabel = modelLabelOf(brain)
  const statusText = sending ? 'Working…' : brain?.configured ? 'Ready' : brainLoaded ? 'Needs an AI key' : 'Loading…'
  const statusDot = sending ? 'bg-primary animate-pulse' : brain?.configured ? 'bg-[var(--status-good)]' : 'bg-[var(--status-warning)]'

  const panel = useMemo(() => (
    <SidePanel
      conversations={conversations}
      activeId={activeConversation?.id ?? null}
      onOpen={openConversation}
      onDelete={deleteConversation}
      approvals={approvals}
      approvalBusy={approvalBusy}
      onDecision={handleApprovalDecision}
      notes={notes}
      tab={panelTab}
      onTab={setPanelTab}
    />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [conversations, activeConversation?.id, approvals, approvalBusy, notes, panelTab])

  return (
    <div className="flex h-[calc(100dvh-5rem)] gap-4 md:h-[calc(100dvh-4rem)]">
      {/* Conversation */}
      <section aria-label="Conversation with the AI Manager" className="@container relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card elev-1">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <AiOrb size={34} working={sending} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight">
              {activeConversation?.title && !isEmpty ? activeConversation.title : 'AI Manager'}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
              <span>{statusText}</span>
              {modelLabel && <span className="hidden truncate @md:inline @2xl:hidden">· {modelLabel}</span>}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowBrainDialog(true)}
              className="hidden h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @2xl:inline-flex"
            >
              <Cpu aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
              {modelLabel ?? 'Choose model'}
            </button>
            <IconButton label="Knowledge base" onClick={() => setShowKBDialog(true)}>
              <BookOpen aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </IconButton>
            <IconButton label={`Chats, approvals and notes${approvals.length ? ` (${approvals.length} waiting)` : ''}`} onClick={() => setShowPanelSheet(true)} className="relative xl:hidden">
              <PanelRight aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
              {approvals.length > 0 && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--status-warning)] ring-2 ring-card" />}
            </IconButton>
            <Button size="sm" onClick={newConversation} className="ml-1 h-9 gap-1.5 rounded-full px-3.5" aria-label="New chat">
              <Plus aria-hidden="true" className="h-4 w-4" />
              <span className="hidden @md:inline">New chat</span>
            </Button>
          </div>
        </header>

        <div ref={scrollContainerRef} onScroll={handleScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
          {isEmpty ? (
            <ChatEmpty needsKey={brainLoaded && !brain?.configured} onPick={(p) => { setInput(p); setFocusToken((t) => t + 1) }} />
          ) : (
            <div ref={contentRef} className="mx-auto w-full max-w-3xl space-y-8 px-4 pb-6 pt-6 sm:px-6">
              {messages.map((msg, i) => (
                <MessageRow key={i} msg={msg} animate={i >= animateFrom} />
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            aria-label="Scroll to the latest message"
            tabIndex={showScrollButton ? 0 : -1}
            aria-hidden={!showScrollButton}
            className={`absolute -top-12 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground elev-2 transition-[opacity,transform] duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              showScrollButton ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
            }`}
          >
            <ArrowDown aria-hidden="true" className="h-4 w-4" />
          </button>
          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={sendMessage}
            onStop={stopSending}
            onAttach={handleFileUpload}
            onRemoveAttachment={(id) => setPendingAttachments((prev) => prev.filter((a) => a.id !== id))}
            attachments={pendingAttachments}
            sending={sending}
            uploading={uploading}
            disabled={brainLoaded && !brain?.configured}
            modelLabel={null}
            focusToken={focusToken}
          />
        </div>
      </section>

      {/* Chats, approvals, notes */}
      <aside aria-label="Chats, approvals and notes" className="hidden w-80 shrink-0 overflow-hidden rounded-2xl border border-border bg-card elev-1 xl:flex xl:flex-col">
        {panel}
      </aside>

      <Dialog open={showPanelSheet} onOpenChange={setShowPanelSheet}>
        <DialogContent className="flex h-[80dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessagesSquare aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              Chats, approvals and notes
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">{panel}</div>
        </DialogContent>
      </Dialog>

      <BrainDialog
        open={showBrainDialog}
        brain={brain}
        onSave={saveBrain}
        onOpenChange={setShowBrainDialog}
      />

      <KnowledgeBaseDialog open={showKBDialog} onOpenChange={setShowKBDialog} />

      {/* The agent asking the owner something mid-task */}
      <Dialog open={!!activeQuestion} onOpenChange={(open) => { if (!open) skipQuestion() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <AiOrb size={32} />
              <DialogTitle>The AI Manager has a question</DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-[15px] leading-relaxed text-foreground/85">
              {activeQuestion?.question}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Textarea
              autoFocus
              value={questionAnswer}
              onChange={(e) => setQuestionAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitQuestionAnswer()
                }
              }}
              aria-label="Your answer"
              placeholder={activeQuestion?.placeholder || 'Type your answer…'}
              className="min-h-[72px] max-h-40 resize-none text-[15px]"
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={skipQuestion} disabled={submittingAnswer}>
                Skip
              </Button>
              <Button onClick={submitQuestionAnswer} disabled={!questionAnswer.trim() || submittingAnswer} className="gap-1.5">
                {submittingAnswer ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Send aria-hidden="true" className="h-4 w-4" />}
                Send answer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IconButton({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      {children}
    </button>
  )
}

function BrainDialog({ open, brain, onSave, onOpenChange }: {
  open: boolean
  brain: BrainConfig | null
  onSave: (config: BrainConfig) => void
  onOpenChange: (open: boolean) => void
}) {
  const [model, setModel] = useState('')

  useEffect(() => {
    if (brain) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModel(brain.model)
    }
  }, [brain, open])

  const provider = brain?.provider || ''
  const providerName = providerInfo[provider as keyof typeof providerInfo]?.name || provider
  const presets = MODEL_PRESETS[provider] || []
  // The saved model may not be a preset (the field is free text in Settings);
  // list it anyway so the select never renders blank.
  const models = presets.some((m) => m.value === model) || !model ? presets : [{ value: model, label: model, note: 'Your saved model.' }, ...presets]
  const selectedNote = models.find((m) => m.value === model)?.note

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose AI Model</DialogTitle>
          <DialogDescription>
            {provider
              ? <>Provider: <span className="font-medium text-foreground">{providerName}</span>. Set the provider &amp; API key in Settings.</>
              : 'No provider configured yet. Set up your API key in Settings first.'}
          </DialogDescription>
        </DialogHeader>

        {provider ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="brain-model" className="text-sm font-medium">Model</label>
              <Select value={model} onValueChange={(v) => { if (v) setModel(v) }}>
                <SelectTrigger id="brain-model" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedNote && <p className="text-xs text-muted-foreground">{selectedNote}</p>}
            <p className="text-xs text-muted-foreground">
              Need to change the provider or API key? Go to <Link href="/settings" className="font-medium text-primary underline underline-offset-2">Settings</Link>.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/5 p-4 text-center">
            <p className="text-sm text-muted-foreground mb-3">You need to configure an AI provider first.</p>
            <Button variant="outline" render={<Link href="/settings" />} nativeButton={false}>
              Go to Settings
            </Button>
          </div>
        )}

        <DialogFooter>
          {provider && (
            <Button
              onClick={() => onSave({ ...(brain as BrainConfig), model, configured: true })}
              className=""
            >
              Save Model
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface KBDocument {
  id: string
  title: string
  sourceType: string
  chunkCount: number
  createdAt: string
}

function KnowledgeBaseDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [documents, setDocuments] = useState<KBDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/knowledge-base')
      const json = await res.json()
      setDocuments(json.documents || [])
    } catch {
      toast.error('Failed to load knowledge base')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) fetchDocs()
  }, [open, fetchDocs])

  async function handleIngestText() {
    if (!content.trim()) return
    setIngesting(true)
    try {
      const res = await fetch('/api/knowledge-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || 'Pasted Text', content: content.trim() }),
      })
      const json = await res.json()
      if (res.ok) {
        toast.success(`Added to knowledge base (${json.chunkCount} chunks)`)
        setTitle('')
        setContent('')
        fetchDocs()
      } else {
        toast.error(json.error || 'Failed to add document')
      }
    } catch {
      toast.error('Failed to add document')
    } finally {
      setIngesting(false)
    }
  }

  async function handleUploadFile(file: File) {
    if (!file) return
    setIngesting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', file.name)
      const res = await fetch('/api/knowledge-base', { method: 'POST', body: formData })
      const json = await res.json()
      if (res.ok) {
        toast.success(`Uploaded "${file.name}" (${json.chunkCount} chunks)`)
        fetchDocs()
      } else {
        toast.error(json.error || 'Failed to upload file')
      }
    } catch {
      toast.error('Failed to upload file')
    } finally {
      setIngesting(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/knowledge-base?id=${id}`, { method: 'DELETE' })
      toast.success('Document deleted')
      fetchDocs()
    } catch {
      toast.error('Failed to delete document')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Knowledge Base (RAG)</DialogTitle>
          <DialogDescription>
            Add documents to give the AI context about your business, products, and marketing strategies.
            The AI will search these documents before responding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv,.json,.md,.pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = '' }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={ingesting} className="w-full">
                {ingesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload File
              </Button>
            </div>
          </div>

          {/* Paste text area */}
          <div className="space-y-2 rounded-lg border border-border/40 p-3">
            <input
              type="text"
              placeholder="Document title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
            <Textarea
              placeholder="Paste text content here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[100px] resize-none"
              rows={4}
            />
            <Button onClick={handleIngestText} disabled={ingesting || !content.trim()} size="sm">
              {ingesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
              Add to Knowledge Base
            </Button>
          </div>

          {/* Documents list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Documents ({documents.length})</h3>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No documents yet. Upload files or paste text to build your knowledge base.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border/40 p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{doc.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-xs">{doc.sourceType}</Badge>
                        <span className="text-xs text-muted-foreground">{doc.chunkCount} chunks</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete document: ${doc.title}`}
                      onClick={() => handleDelete(doc.id)}
                      className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--status-critical)]/10 hover:text-[var(--status-critical-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
