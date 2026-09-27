export interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: unknown
  error?: string
  status: 'pending' | 'done' | 'error'
}

export interface ChatAttachment {
  url: string
  type: string
  name: string
}

export interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  thinking?: boolean
  thinkingPhase?: 'reasoning' | 'analyzing'
  toolCalls?: ToolCallInfo[]
  attachments?: ChatAttachment[]
  createdAt?: string
}

export interface ChartSpec {
  chartType: string
  data: Array<Record<string, unknown>>
  xKey: string
  yKeys: Array<{ key: string; label: string; color?: string }>
  title: string
}
