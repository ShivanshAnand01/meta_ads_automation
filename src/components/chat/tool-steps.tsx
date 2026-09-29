'use client'

import { memo, useState } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { Check, ChevronRight, Loader2, ShieldAlert, Volume2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSpecialist } from '@/lib/ai/agents/registry'
import { Markdown } from './markdown'
import type { ChartSpec, ToolCallInfo } from './types'

const ChatChart = dynamic(() => import('./chat-chart'), {
  ssr: false,
  loading: () => <div className="h-60 w-full animate-pulse rounded-xl bg-muted" />,
})

/** [while running, when done] — plain words for the owner, not function names. */
const STEP_LABELS: Record<string, [string, string]> = {
  get_business_profile: ['Reading your business profile', 'Read your business profile'],
  set_business_profile: ['Updating your business profile', 'Updated your business profile'],
  ingest_website: ['Reading your website', 'Read your website'],
  test_meta_connection: ['Checking your Meta connection', 'Checked your Meta connection'],
  validate_token: ['Checking your Meta token', 'Checked your Meta token'],
  sync_campaign_insights: ['Syncing campaign results', 'Synced campaign results'],
  sync_from_meta: ['Syncing campaigns from Meta', 'Synced campaigns from Meta'],
  get_insights: ['Reading ad results', 'Read ad results'],
  list_campaigns: ['Looking at your campaigns', 'Looked at your campaigns'],
  list_ad_sets: ['Looking at your ad sets', 'Looked at your ad sets'],
  list_ads: ['Looking at your ads', 'Looked at your ads'],
  list_pages: ['Finding your Facebook Pages', 'Found your Facebook Pages'],
  list_pixels: ['Checking your Pixels', 'Checked your Pixels'],
  get_dashboard_summary: ['Summarising your account', 'Summarised your account'],
  get_performance_trend: ['Reading performance trend', 'Read performance trend'],
  get_daily_metrics: ['Reading daily results', 'Read daily results'],
  get_account_balance: ['Checking account balance', 'Checked account balance'],
  get_strategy: ['Reading your strategy and caps', 'Read your strategy and caps'],
  update_strategy: ['Updating your strategy', 'Updated your strategy'],
  generate_ad_image: ['Creating an image', 'Created an image'],
  generate_creative_with_image: ['Writing an ad with an image', 'Wrote an ad with an image'],
  create_local_creative: ['Saving a creative draft', 'Saved a creative draft'],
  review_creative: ['Reviewing the creative', 'Reviewed the creative'],
  improve_creative: ['Improving the creative', 'Improved the creative'],
  create_local_campaign: ['Drafting a campaign', 'Drafted a campaign'],
  publish_full_campaign: ['Publishing to Meta', 'Published to Meta'],
  publish_campaign_to_meta: ['Publishing to Meta', 'Published to Meta'],
  search_knowledge_base: ['Searching your knowledge base', 'Searched your knowledge base'],
  research_web: ['Researching the web', 'Researched the web'],
  check_publish_readiness: ['Checking the campaign can publish', 'Checked the campaign can publish'],
  list_connected_tools: ['Checking connected tools', 'Checked connected tools'],
  call_connected_tool: ['Running a connected tool', 'Ran a connected tool'],
  get_memory: ['Recalling what worked before', 'Recalled what worked before'],
  search_memory: ['Recalling what worked before', 'Recalled what worked before'],
  add_memory: ['Saving a learning', 'Saved a learning'],
  reflect_and_learn: ['Reflecting on results', 'Reflected on results'],
  generate_chart: ['Drawing a chart', 'Drew a chart'],
  generate_report: ['Writing a report', 'Wrote a report'],
  speak: ['Recording a voice reply', 'Recorded a voice reply'],
  transcribe_audio: ['Transcribing audio', 'Transcribed audio'],
  create_scheduled_job: ['Scheduling a routine', 'Scheduled a routine'],
  ask_user_question: ['Asking you a question', 'Asked you a question'],
}

export function stepLabel(name: string, status: ToolCallInfo['status'], args?: Record<string, unknown>): string {
  if (name === 'delegate_to_agent') {
    const who = getSpecialist(String(args?.agent ?? ''))?.name ?? 'a specialist'
    const the = who === 'a specialist' ? who : `the ${who}`
    return status === 'pending' ? `Asking ${the}…` : `Asked ${the}`
  }
  const pair = STEP_LABELS[name]
  if (pair) return status === 'pending' ? `${pair[0]}…` : pair[1]
  const words = name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function resultOf(tc: ToolCallInfo): Record<string, unknown> | null {
  return typeof tc.result === 'object' && tc.result !== null ? (tc.result as Record<string, unknown>) : null
}

const ToolStep = memo(function ToolStep({ toolCall }: { toolCall: ToolCallInfo }) {
  // Local state: expanding one step no longer re-renders the whole chat.
  const [open, setOpen] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const r = resultOf(toolCall)
  const needsApproval = Boolean(r?.needsApproval)
  const chart = r?.chart as ChartSpec | undefined
  const audioUrl = r?.audioUrl as string | undefined
  const report = r?.report as string | undefined
  const imageUrl = r?.imageUrl as string | undefined
  const delegated = toolCall.name === 'delegate_to_agent'
  // A specialist's summary is the useful part; its "finished" line is not.
  const message = (delegated ? (r?.summary as string | undefined) : undefined)
    || (r?.message as string | undefined) || (r?.summary as string | undefined) || (r?.transcript as string | undefined)
  const pending = toolCall.status === 'pending'
  const failed = toolCall.status === 'error' || Boolean(toolCall.error) || (delegated && r?.status === 'failed')
  const hasDetail = Boolean(toolCall.error || needsApproval || chart || audioUrl || report || imageUrl || message || toolCall.result !== undefined)

  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className={cn(
          'group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
          hasDetail && 'hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !hasDetail && 'cursor-default',
        )}
      >
        <span
          className={cn(
            'relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-card',
            pending && 'border-primary/40 text-primary',
            failed && 'border-[var(--status-critical)]/40 bg-[var(--status-critical)]/10 text-[var(--status-critical-ink)] dark:text-red-300',
            needsApproval && !failed && 'border-[var(--status-warning)]/50 bg-[var(--status-warning)]/15 text-amber-700 dark:text-amber-300',
            !pending && !failed && !needsApproval && 'border-[var(--status-good)]/35 bg-[var(--status-good)]/10 text-[var(--status-good-ink)] dark:text-green-300',
          )}
        >
          {pending ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            : failed ? <X aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
              : needsApproval ? <ShieldAlert aria-hidden="true" className="h-3 w-3" />
                : <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', pending ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} title={toolCall.name}>
          {stepLabel(toolCall.name, toolCall.status, toolCall.arguments)}
          {failed && <span className="ml-1.5 font-medium text-[var(--status-critical-ink)] dark:text-red-300">failed</span>}
          {needsApproval && !failed && <span className="ml-1.5 font-medium text-amber-700 dark:text-amber-300">needs your approval</span>}
        </span>
        {hasDetail && (
          <ChevronRight aria-hidden="true" className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-90')} />
        )}
      </button>

      {hasDetail && (
        <div className="collapse-grid" data-open={open}>
          {/* inert while closed: hidden controls must not take keyboard focus. */}
          <div inert={!open}>
            <div className="mb-1 ml-[1.1rem] mt-1 space-y-2.5 border-l border-border pl-5 pr-1 pb-1.5">
              {toolCall.error ? (
                <p role="status" className="rounded-lg border border-[var(--status-critical)]/25 bg-[var(--status-critical)]/5 px-3 py-2 text-[13px] text-[var(--status-critical-ink)] dark:text-red-300">{toolCall.error}</p>
              ) : needsApproval ? (
                <p className="rounded-lg border border-[var(--status-warning)]/30 bg-[var(--status-warning)]/5 px-3 py-2 text-[13px] text-foreground/80">{message || 'Queued for your approval. Review it in the Approvals tab.'}</p>
              ) : audioUrl ? (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Volume2 aria-hidden="true" className="h-3.5 w-3.5" />{message || 'Voice reply'}</p>
                  <audio controls src={audioUrl} className="h-9 w-full" />
                </div>
              ) : chart ? (
                <ChatChart spec={chart} />
              ) : report ? (
                <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-muted/30 p-3 scrollbar-thin"><Markdown content={report} /></div>
              ) : imageUrl ? (
                <p className="text-[13px] text-muted-foreground">{message || 'Image created. It is shown below.'}</p>
              ) : message ? (
                <p className="text-[13px] leading-relaxed text-muted-foreground">{message}</p>
              ) : null}

              {toolCall.result !== undefined && (
                <div>
                  <button
                    type="button"
                    aria-expanded={showRaw}
                    onClick={() => setShowRaw((v) => !v)}
                    className="text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showRaw ? 'Hide technical details' : 'Show technical details'}
                  </button>
                  {showRaw && (
                    <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-border bg-muted/50 p-2.5 font-mono text-xs leading-relaxed scrollbar-thin">
                      {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  )
})

/** The agent's work for one reply, as a compact vertical timeline. */
export const ToolSteps = memo(function ToolSteps({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  return (
    <ol aria-label="Steps the agent took" className="relative space-y-0.5 before:absolute before:bottom-3 before:left-[1.1rem] before:top-3 before:w-px before:bg-border">
      {toolCalls.map((tc) => <ToolStep key={tc.id} toolCall={tc} />)}
    </ol>
  )
})

function imagesFrom(toolCalls: ToolCallInfo[]): Array<{ url: string; message?: string }> {
  const out: Array<{ url: string; message?: string }> = []
  for (const tc of toolCalls) {
    const r = resultOf(tc)
    if (tc.status !== 'done' || tc.error || !r) continue
    const url = (r.imageUrl as string | undefined) || ((r.creative as Record<string, unknown> | undefined)?.imageUrl as string | undefined)
    if (url) out.push({ url, message: r.message as string | undefined })
  }
  return out
}

/** Generated images, shown full width under the reply, like a finished result. */
export const InlineImages = memo(function InlineImages({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const images = imagesFrom(toolCalls)
  if (images.length === 0) return null
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {images.map((img, i) => (
        <figure key={i} className="elev-1 overflow-hidden rounded-xl border border-border bg-card">
          <Image src={img.url} alt={img.message || 'Ad creative generated by the AI Manager'} width={800} height={800} className="aspect-square w-full bg-muted/30 object-contain" loading="lazy" />
          {img.message && <figcaption className="border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">{img.message}</figcaption>}
        </figure>
      ))}
    </div>
  )
})
