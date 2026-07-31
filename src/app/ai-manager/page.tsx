'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Send, Loader2, Brain, StickyNote, Plus, Trash2,
  Wrench, CheckCircle2, XCircle, History, Sparkles, Square,
  ChevronDown, Cpu, Key, Server, Paperclip, X, Image as ImageIcon,
  Zap, TrendingUp, Eye, PenLine, BookOpen, Upload,
  ShieldAlert, Volume2, BarChart3, HelpCircle,
} from 'lucide-react'

interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: unknown
  error?: string
  status: 'pending' | 'done' | 'error'
}

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  thinking?: boolean
  thinkingPhase?: 'reasoning' | 'analyzing'
  toolCalls?: ToolCallInfo[]
  attachments?: Array<{ url: string; type: string; name: string }>
  createdAt?: string
}

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
  anthropic: { name: 'Claude (Anthropic)', icon: Sparkles, needsApiKey: true, needsBaseUrl: false, defaultBaseUrl: '', defaultModel: 'claude-3-5-sonnet-20241022' },
  ollama: { name: 'Ollama (Local)', icon: Cpu, needsApiKey: false, needsBaseUrl: true, defaultBaseUrl: 'http://localhost:11434', defaultModel: 'llama3' },
  openai: { name: 'OpenAI GPT', icon: Key, needsApiKey: true, needsBaseUrl: false, defaultBaseUrl: '', defaultModel: 'gpt-4o-mini' },
  groq: { name: 'Groq', icon: Server, needsApiKey: true, needsBaseUrl: false, defaultBaseUrl: '', defaultModel: 'llama-3.3-70b-versatile' },
}

const providerModels: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  ollama: [
    { value: 'llama3', label: 'Llama 3 (8B)' },
    { value: 'llama3:70b', label: 'Llama 3 (70B)' },
    { value: 'qwen2.5', label: 'Qwen 2.5' },
    { value: 'mistral', label: 'Mistral' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Recommended)' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  ],
}

const suggestions = [
  { icon: TrendingUp, text: 'Show me my campaigns and their performance' },
  { icon: PenLine, text: 'Create a full Marathi ad creative with image for my ebook' },
  { icon: ImageIcon, text: 'Generate an ad creative image' },
  { icon: Eye, text: 'Review my latest ad creative' },
  { icon: Zap, text: 'Test my Meta connection and tell me if it works' },
]

function safeParseArray(s: string | null | undefined): unknown[] {
  if (!s) return []
  try { return JSON.parse(s) } catch { return [] }
}

function brainShortLabel(b: BrainConfig): string {
  const prov = providerInfo[b.provider as keyof typeof providerInfo]
  const modelLabel = providerModels[b.provider]?.find((m) => m.value === b.model)?.label || b.model
  return `${prov?.name.split(' ')[0]} · ${modelLabel}`
}

const toolIcons: Record<string, typeof Wrench> = {
  ask_user_question: HelpCircle,
  generate_ad_image: ImageIcon,
  generate_creative_with_image: ImageIcon,
  review_creative: Eye,
  improve_creative: PenLine,
  get_dashboard_summary: TrendingUp,
  create_local_campaign: Plus,
  create_local_creative: Plus,
  search_knowledge_base: BookOpen,
  generate_chart: BarChart3,
  generate_report: BarChart3,
  speak: Volume2,
  transcribe_audio: Volume2,
  sync_campaign_insights: TrendingUp,
  get_performance_trend: TrendingUp,
  get_strategy: ShieldAlert,
  update_strategy: ShieldAlert,
  get_memory: StickyNote,
  add_memory: StickyNote,
  publish_campaign_to_meta: ShieldAlert,
  set_campaign_status: ShieldAlert,
  test_meta_connection: ShieldAlert,
}

interface Approval {
  id: string
  toolName: string
  summary: string
  risk: string
  status: string
  createdAt: string
}

const CHART_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#8b5cf6', '#ec4899', '#eab308']

function ChartRenderer({ spec }: { spec: { chartType: string; data: Array<Record<string, unknown>>; xKey: string; yKeys: Array<{ key: string; label: string; color?: string }>; title: string } }) {
  if (!spec?.data?.length) return <p className="text-xs text-muted-foreground">No data to chart.</p>
  const { chartType, data, xKey, yKeys, title } = spec
  const yk = yKeys || []
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold">{title}</p>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {yk.map((y, i) => (
                <Line key={y.key} type="monotone" dataKey={y.key} name={y.label} stroke={y.color || CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          ) : chartType === 'area' ? (
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {yk.map((y, i) => (
                <Area key={y.key} type="monotone" dataKey={y.key} name={y.label} stroke={y.color || CHART_COLORS[i % CHART_COLORS.length]} fill={y.color || CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.25} strokeWidth={2} />
              ))}
            </AreaChart>
          ) : chartType === 'pie' ? (
            <PieChart>
              <RTooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Pie data={data} dataKey={yk[0]?.key || 'value'} nameKey={xKey} cx="50%" cy="50%" outerRadius={70}>
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
            </PieChart>
          ) : chartType === 'funnel' ? (
            <BarChart data={data} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey={xKey} tick={{ fontSize: 10 }} width={80} />
              <RTooltip />
              <Bar dataKey={yk[0]?.key || 'value'} name={yk[0]?.label || 'Count'} radius={[0, 4, 4, 0]}>
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {yk.map((y, i) => (
                <Bar key={y.key} dataKey={y.key} name={y.label} fill={y.color || CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ApprovalCard({ approval, onDecision, busy }: { approval: { id: string; toolName: string; summary: string; risk: string }; onDecision: (id: string, decision: 'approve' | 'reject') => void; busy: boolean }) {
  const riskColor = approval.risk === 'high' ? 'text-red-500' : approval.risk === 'medium' ? 'text-amber-500' : 'text-emerald-500'
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-mono font-semibold text-primary">{approval.toolName}</span>
        <span className={`text-[10px] font-semibold ml-auto uppercase ${riskColor}`}>{approval.risk} risk</span>
      </div>
      <p className="text-xs text-muted-foreground">{approval.summary}</p>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs gradient-bg animate-gradient" disabled={busy} onClick={() => onDecision(approval.id, 'approve')}>
          Approve & Run
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onDecision(approval.id, 'reject')}>
          Reject
        </Button>
      </div>
    </div>
  )
}

export default function AIManagerPage() {
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ url: string; type: string; name: string }>>([])
  const [brain, setBrain] = useState<BrainConfig | null>(null)
  const [showBrainDialog, setShowBrainDialog] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showKBDialog, setShowKBDialog] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [abortRef, setAbortRef] = useState<AbortController | null>(null)
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
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

  async function handleApprovalDecision(id: string, decision: 'approve' | 'reject') {
    setApprovalBusy(id)
    try {
      const res = await fetch('/api/ai-manager/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId: id, decision }),
      })
      const json = await res.json()
      if (res.ok) {
        toast.success(decision === 'approve' ? 'Action approved & executed' : 'Action rejected')
        if (decision === 'approve' && json.result) {
          setApprovals((prev) => prev.filter((a) => a.id !== id))
        } else {
          setApprovals((prev) => prev.filter((a) => a.id !== id))
        }
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

  useEffect(() => {
    if (!autoScroll) return
    const el = scrollContainerRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
  }, [activeConversation?.messages, autoScroll])

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
    } catch {}
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConversations()
     
    fetchBrain()
     
    fetchApprovals()
  }, [fetchConversations, fetchBrain, fetchApprovals])

  async function handleFileUpload(file: File) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large (max 10MB)')
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
      setPendingAttachments((prev) => [...prev, { url: json.url, type: json.fileType, name: json.fileName }])
      toast.success('File attached')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function sendMessage() {
    if ((!input.trim() && pendingAttachments.length === 0) || sending) return
    if (!brain?.configured) {
      toast.error('Configure your AI brain first')
      setShowBrainDialog(true)
      return
    }

    const message = input.trim() || (pendingAttachments.length > 0 ? 'Please analyze the attached image(s) and provide recommendations.' : '')
    setInput('')
    const attachments = [...pendingAttachments]
    setPendingAttachments([])
    setAutoScroll(true)
    setSending(true)

    const controller = new AbortController()
    setAbortRef(controller)

    const existingId = activeConversation && activeConversation.id !== 'temp' ? activeConversation.id : null

    const placeholder: Message = {
      role: 'assistant', content: '', streaming: true, thinking: true, thinkingPhase: 'reasoning', toolCalls: [],
    }

    const baseMessages: Message[] = existingId ? [...activeConversation!.messages] : []
    baseMessages.push({ role: 'user', content: message, attachments: attachments.length > 0 ? attachments : undefined })
    baseMessages.push(placeholder)

    const conv: Conversation = existingId
      ? { ...activeConversation!, messages: baseMessages }
      : { id: 'temp', title: message.slice(0, 50), messages: baseMessages, notes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    setActiveConversation(conv)

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

            if (ev.t === 'init') {
              if (activeConversation?.id === 'temp') {
                setActiveConversation((prev) => prev ? { ...prev, id: ev.conversationId } : prev)
              }
            } else if (ev.t === 'thinking') {
              updateLastAssistant((m) => ({ ...m, thinking: true, thinkingPhase: ev.phase }))
            } else if (ev.t === 'text') {
              updateLastAssistant((m) => ({ ...m, content: m.content + ev.v, thinking: false }))
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

      updateLastAssistant((m) => ({ ...m, streaming: false, thinking: false }))
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        updateLastAssistant((m) => ({ ...m, streaming: false, thinking: false }))
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to send message')
        updateLastAssistant((m) => ({ ...m, streaming: false, thinking: false, content: m.content || 'Failed to generate response.' }))
      }
    } finally {
      setSending(false)
      setAbortRef(null)
      fetchConversations()
      fetchApprovals()
    }
  }

  function updateLastAssistant(fn: (m: Message) => Message) {
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

  function toggleToolExpanded(id: string) {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function newConversation() {
    setActiveConversation(null)
    setNotes([])
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
        toast.success('Model saved!')
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

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4">
      {/* Main chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-1 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-bg shadow-md">
              <Brain className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">AI Manager</h1>
              <p className="text-xs text-muted-foreground">
                {activeConversation?.title || 'New conversation'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowKBDialog(true)} className="glass">
              <BookOpen className="mr-1.5 h-3.5 w-3.5" />
              Knowledge Base
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowBrainDialog(true)} className="glass">
              {brain ? (
                <><Cpu className="mr-1.5 h-3.5 w-3.5" />{brainShortLabel(brain)}</>
              ) : (
                <><Brain className="mr-1.5 h-3.5 w-3.5" />Configure</>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={newConversation} className="glass">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <Card className="glass card-3d relative flex flex-1 flex-col overflow-hidden">
          <div className="relative flex-1 overflow-hidden">
            <div ref={scrollContainerRef} onScroll={handleScroll} className="h-full overflow-y-auto scrollbar-thin">
            <div className="space-y-6 p-4 pb-8">
              {(!activeConversation || activeConversation.messages.length === 0) ? (
                <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-6">
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex h-16 w-16 items-center justify-center rounded-2xl gradient-bg animate-gradient shadow-xl glow-md"
                  >
                    <Sparkles className="h-7 w-7 text-white" />
                  </motion.div>
                  <div className="text-center">
                    <h2 className="text-xl font-bold gradient-text">AI Ads Manager</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your AI brain for Meta Ads. Ask anything, create campaigns, generate creatives.
                    </p>
                  </div>
                  <div className="grid w-full max-w-lg gap-2 sm:grid-cols-2">
                    {suggestions.map((s, i) => (
                      <motion.button
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        onClick={() => { setInput(s.text) }}
                        className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/50 p-3 text-left text-sm transition-colors hover:bg-muted hover:border-primary/30"
                      >
                        <s.icon className="h-4 w-4 text-primary shrink-0" />
                        <span>{s.text}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              ) : (
                <AnimatePresence>
                  {activeConversation.messages.map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg gradient-bg shadow-md mt-1">
                          <Brain className="h-3.5 w-3.5 text-white" />
                        </div>
                      )}

                      <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                        {msg.role === 'user' ? (
                          <div className="rounded-2xl gradient-bg animate-gradient px-4 py-2.5 text-sm text-white shadow-md">
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {/* Thinking indicator */}
                            {msg.thinking && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                              <ThinkingIndicator phase={msg.thinkingPhase} />
                            )}

                            {/* Text content */}
                            {msg.content && (
                              <div className="rounded-2xl glass card-3d px-4 py-3">
                                <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:my-2 prose-p:my-1 prose-ul:my-1 prose-pre:my-2 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                    {msg.content}
                                  </ReactMarkdown>
                                </div>
                                {msg.streaming && !msg.thinking && (
                                  <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse rounded-full bg-primary align-text-bottom" />
                                )}
                              </div>
                            )}

                            {/* Tool calls */}
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <div className="space-y-2">
                                {msg.toolCalls.map((tc) => (
                                  <ToolCard
                                    key={tc.id}
                                    toolCall={tc}
                                    expanded={expandedTools.has(tc.id)}
                                    onToggle={() => toggleToolExpanded(tc.id)}
                                  />
                                ))}
                              </div>
                            )}

                            {/* Inline images from completed tool calls (like ChatGPT) */}
                            {msg.toolCalls && msg.toolCalls.length > 0 && !msg.streaming && (
                              <InlineImages toolCalls={msg.toolCalls} />
                            )}

                            {/* Thinking again (between tool rounds) */}
                            {msg.thinking && (msg.content || (msg.toolCalls && msg.toolCalls.length > 0)) && (
                              <ThinkingIndicator phase={msg.thinkingPhase} compact />
                            )}

                            {/* User attachments */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {msg.attachments.map((att, j) => (
                                  <div key={j} className="relative rounded-lg overflow-hidden border border-border/30">
                                    {att.type.startsWith('image/') ? (
                                      <Image src={att.url} alt={att.name} width={96} height={96} className="h-24 w-24 object-cover" />
                                    ) : (
                                      <div className="flex items-center gap-2 rounded-lg bg-background/50 p-2 h-24 w-24">
                                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground truncate">{att.name}</span>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
            </div>
            <AnimatePresence>
              {showScrollButton && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  onClick={() => scrollToBottom(true)}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full glass border border-border/50 shadow-lg hover:scale-110 transition-transform"
                >
                  <ChevronDown className="h-4 w-4 text-primary" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Pending attachments */}
          {pendingAttachments.length > 0 && (
            <div className="border-t border-border/50 px-4 pt-2 pb-1 flex flex-wrap gap-2">
              {pendingAttachments.map((att, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden border border-border/30">
                  {att.type.startsWith('image/') ? (
                    <Image src={att.url} alt={att.name} width={64} height={64} className="h-16 w-16 object-cover" />
                  ) : (
                    <div className="flex items-center gap-1 bg-background/50 p-2 h-16 w-16">
                      <Paperclip className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground truncate">{att.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0 right-0 rounded-bl-lg bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="border-t border-border/50 p-3">
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.txt,.csv,.json"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 glass"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Ask AI to manage your ads…"
                disabled={sending}
                className="min-h-[40px] max-h-32 resize-none glass border-border/50"
                rows={1}
              />
              {sending ? (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={stopSending}
                  className="shrink-0"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={sendMessage}
                  disabled={(!input.trim() && pendingAttachments.length === 0) || !brain?.configured}
                  className="shrink-0 gradient-bg animate-gradient shadow-lg"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Right sidebar */}
      <div className="hidden w-72 shrink-0 space-y-3 overflow-y-auto lg:block">
        {/* Approvals (guardrail queue) */}
        {approvals.length > 0 && (
          <Card className="glass card-3d border-amber-500/40">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-sm">Pending Approvals ({approvals.length})</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {approvals.map((a) => (
                <ApprovalCard key={a.id} approval={a} busy={approvalBusy === a.id} onDecision={handleApprovalDecision} />
              ))}
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        <Card className="glass card-3d">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm">AI Notes</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {notes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Notes from AI will appear here</p>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{note.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{note.content}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* History toggle */}
        <Button variant="outline" className="w-full glass" onClick={() => setShowHistory(!showHistory)}>
          <History className="mr-2 h-4 w-4" />
          {showHistory ? 'Hide' : 'Show'} History
        </Button>

        {/* Conversations */}
        {showHistory && (
          <Card className="glass card-3d">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Conversations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {conversations.length === 0 ? (
                <p className="text-xs text-muted-foreground">No conversations yet</p>
              ) : (
                conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between rounded-lg p-2 text-xs cursor-pointer transition-colors ${
                      activeConversation?.id === c.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                    }`}
                    onClick={() => { setActiveConversation(c); setNotes(c.notes || []); setAutoScroll(true) }}
                  >
                    <span className="truncate flex-1">{c.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c.id) }}
                      className="ml-1 shrink-0 text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {/* Tools */}
        <Card className="glass card-3d">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-emerald-500" />
              <CardTitle className="text-sm">Available Tools</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {ALL_TOOL_NAMES.map((tool) => {
                const Icon = toolIcons[tool] || Wrench
                return (
                  <Badge key={tool} variant="secondary" className="text-[10px] font-mono gap-1">
                    <Icon className="h-2.5 w-2.5" />
                    {tool}
                  </Badge>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Brain config dialog */}
      <BrainDialog
        open={showBrainDialog}
        brain={brain}
        onSave={saveBrain}
        onOpenChange={setShowBrainDialog}
      />

      {/* Knowledge base dialog */}
      <KnowledgeBaseDialog open={showKBDialog} onOpenChange={setShowKBDialog} />

      {/* AI question popup */}
      <Dialog open={!!activeQuestion} onOpenChange={(open) => { if (!open) skipQuestion() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-bg shadow-md">
                <HelpCircle className="h-4 w-4 text-white" />
              </div>
              <DialogTitle>AI has a question</DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-sm text-foreground/80">
              {activeQuestion?.question}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
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
              placeholder={activeQuestion?.placeholder || 'Type your answer...'}
              className="min-h-[60px] max-h-32 resize-none"
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={skipQuestion} disabled={submittingAnswer}>
                Skip
              </Button>
              <Button
                size="sm"
                onClick={submitQuestionAnswer}
                disabled={!questionAnswer.trim() || submittingAnswer}
                className="gradient-bg animate-gradient"
              >
                {submittingAnswer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const ALL_TOOL_NAMES = [
  'ask_user_question',
  'get_local_campaigns', 'get_local_creatives', 'get_local_campaign', 'get_dashboard_summary',
  'search_knowledge_base',
  'create_local_campaign', 'update_local_campaign', 'delete_local_campaign',
  'create_local_creative', 'update_local_creative', 'delete_local_creative',
  'generate_ad_image', 'generate_creative_with_image', 'review_creative', 'improve_creative',
  // Mastermind
  'get_strategy', 'update_strategy', 'get_memory', 'add_memory',
  'sync_campaign_insights', 'sync_from_meta', 'publish_campaign_to_meta', 'set_campaign_status',
  'get_daily_metrics', 'get_performance_trend', 'get_account_balance', 'test_meta_connection',
  'list_scheduled_jobs', 'create_scheduled_job', 'update_scheduled_job', 'delete_scheduled_job',
  'generate_chart', 'generate_report', 'transcribe_audio', 'speak',
  // Meta (via stateless client / MCP)
  'list_campaigns', 'create_campaign', 'pause_campaign', 'resume_campaign',
  'get_insights', 'compare_performance', 'list_creatives', 'create_ad_creative',
  'preview_ad', 'list_audiences', 'create_custom_audience', 'estimate_audience_size',
  'validate_token',
]

function extractImagesFromToolCalls(toolCalls: ToolCallInfo[]): Array<{ url: string; toolName: string; message?: string }> {
  const images: Array<{ url: string; toolName: string; message?: string }> = []
  for (const tc of toolCalls) {
    if (tc.status !== 'done' || !tc.result || tc.error) continue
    const resultObj = typeof tc.result === 'object' && tc.result !== null
      ? tc.result as Record<string, unknown>
      : null
    if (!resultObj) continue
    const message = resultObj.message as string | undefined
    // Direct imageUrl (generate_ad_image)
    const directUrl = resultObj.imageUrl as string | undefined
    if (directUrl) {
      images.push({ url: directUrl, toolName: tc.name, message })
      continue
    }
    // Nested creative.imageUrl (generate_creative_with_image)
    const creative = resultObj.creative as Record<string, unknown> | undefined
    const creativeUrl = creative?.imageUrl as string | undefined
    if (creativeUrl) {
      images.push({ url: creativeUrl, toolName: tc.name, message })
    }
  }
  return images
}

function InlineImages({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const images = extractImagesFromToolCalls(toolCalls)
  if (images.length === 0) return null
  return (
    <div className="space-y-3">
      {images.map((img, i) => (
        <div key={i} className="rounded-2xl glass card-3d overflow-hidden">
          <Image
            src={img.url}
            alt="AI generated ad creative"
            width={800}
            height={420}
            className="w-full max-h-[420px] object-contain bg-muted/20"
            loading="lazy"
          />
          {img.message && (
            <p className="px-3 py-2 text-xs text-muted-foreground border-t border-border/30">{img.message}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function ThinkingIndicator({ phase, compact }: { phase?: string; compact?: boolean }) {
  const label = phase === 'analyzing' ? 'Analyzing results…' : 'Thinking…'
  return (
    <div className={`flex items-center gap-2 ${compact ? 'pt-1' : 'py-1'}`}>
      <div className="flex gap-1">
        {[0, 1, 2].map((k) => (
          <motion.div
            key={k}
            animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 1, delay: k * 0.2 }}
            className="h-2 w-2 rounded-full bg-primary"
          />
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

function ToolCard({ toolCall, expanded, onToggle }: {
  toolCall: ToolCallInfo
  expanded: boolean
  onToggle: () => void
}) {
  const Icon = toolIcons[toolCall.name] || Wrench
  const resultObj = typeof toolCall.result === 'object' && toolCall.result !== null
    ? toolCall.result as Record<string, unknown>
    : null
  const imageUrl = resultObj?.imageUrl as string | undefined
  const chartSpec = resultObj?.chart as { chartType: string; data: Array<Record<string, unknown>>; xKey: string; yKeys: Array<{ key: string; label: string; color?: string }>; title: string } | undefined
  const audioUrl = resultObj?.audioUrl as string | undefined
  const needsApproval = Boolean(resultObj?.needsApproval)
  const reportMd = resultObj?.report as string | undefined

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${
      toolCall.status === 'pending'
        ? 'border-primary/30 bg-primary/5'
        : 'border-border/40 bg-background/60'
    }`}>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full p-2.5 text-left hover:bg-muted/50 transition-colors"
      >
        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${
          toolCall.status === 'pending' ? 'bg-amber-500/15' :
          toolCall.status === 'error' ? 'bg-red-500/15' : 'bg-emerald-500/15'
        }`}>
          {toolCall.status === 'pending' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
          ) : toolCall.status === 'error' ? (
            <XCircle className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          )}
        </div>
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-mono font-medium text-primary">{toolCall.name}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {toolCall.status === 'pending' ? 'Running…' : toolCall.status === 'error' ? 'Failed' : 'Done'}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/30 overflow-hidden"
          >
            <div className="p-2.5 space-y-2">
              {Object.keys(toolCall.arguments).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Arguments</p>
                  <pre className="text-[11px] bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-40 scrollbar-thin">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                </div>
              )}
              {toolCall.error ? (
                <div>
                  <p className="text-[10px] font-semibold text-red-500 uppercase mb-1">Error</p>
                  <p className="text-xs text-red-500">{toolCall.error}</p>
                </div>
              ) : toolCall.result !== undefined && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Result</p>
                  {needsApproval ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-[11px] font-semibold">Needs your approval</span>
                        {(resultObj?.risk as string) && (
                          <span className="text-[10px] uppercase ml-auto text-amber-500">{resultObj?.risk as string} risk</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{(resultObj?.summary as string) || (resultObj?.message as string) || 'Spend-affecting action queued.'}</p>
                      <p className="text-[11px] text-muted-foreground">Approve it in the Approvals panel on the right.</p>
                    </div>
                  ) : audioUrl ? (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><Volume2 className="h-3 w-3" /> {(resultObj?.message as string) || 'Voice reply'}</p>
                      <audio controls src={audioUrl} className="w-full h-9" />
                    </div>
                  ) : chartSpec ? (
                    <ChartRenderer spec={chartSpec} />
                  ) : reportMd ? (
                    <pre className="text-[11px] bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-60 scrollbar-thin whitespace-pre-wrap">{reportMd.slice(0, 1500)}</pre>
                  ) : imageUrl ? (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {(resultObj?.message as string) || 'Image generated successfully'}
                      </p>
                      <Image
                        src={imageUrl}
                        alt="Generated"
                        width={600}
                        height={256}
                        className="rounded-lg max-w-full max-h-64 object-cover border border-border/30"
                      />
                    </div>
                  ) : (
                    <pre className="text-[11px] bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-60 scrollbar-thin">
                      {typeof toolCall.result === 'string'
                        ? toolCall.result.slice(0, 500)
                        : JSON.stringify(toolCall.result, null, 2).slice(0, 500)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
  const models = providerModels[provider] || []

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
              <label className="text-xs font-medium">Model</label>
              <Select value={model} onValueChange={(v) => { if (v) setModel(v) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Need to change the provider or API key? Go to <button onClick={() => window.location.href = '/settings'} className="text-primary underline">Settings</button>.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-center">
            <p className="text-sm text-muted-foreground mb-3">You need to configure an AI provider first.</p>
            <Button variant="outline" onClick={() => window.location.href = '/settings'}>
              Go to Settings
            </Button>
          </div>
        )}

        <DialogFooter>
          {provider && (
            <Button
              onClick={() => onSave({ ...(brain as BrainConfig), model, configured: true })}
              className="gradient-bg animate-gradient"
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
          <div className="grid gap-3 sm:grid-cols-2">
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
                        <Badge variant="secondary" className="text-[10px]">{doc.sourceType}</Badge>
                        <span className="text-[10px] text-muted-foreground">{doc.chunkCount} chunks</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="ml-2 text-muted-foreground hover:text-red-500 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
