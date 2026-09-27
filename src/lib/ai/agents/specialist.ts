import type { ToolExecutionContext } from '@/lib/ai/tools'
import type { ToolDefinition } from '@/lib/ai/types'
import { extractJson } from '@/lib/ai/structured'
import { specialistReportSchema, type SpecialistConfig, type SpecialistReport } from './registry'

/**
 * The pure half of running a specialist — the parts that decide what it may
 * do and what counts as a valid answer. No database, so tests exercise the
 * real gate, not a copy of it.
 */

export type SpecialistActor = `specialist:${string}`

export interface ToolLogEntry {
  tool: string
  args: Record<string, unknown>
  refused?: boolean
  error?: string
  /** Truncated: the full result lives in the audit log. */
  resultPreview?: string
}

/**
 * The tool context a specialist runs with: the business's own, never with
 * auto-approval, and an actor the approval gate recognises — so even with
 * auto-optimize on, a specialist that somehow reached an approval tool would
 * only queue it (mayExecuteWithoutApproval in guardrails.ts).
 */
export function specialistToolContext(
  base: Pick<ToolExecutionContext, 'userId' | 'conversationId' | 'local'>,
  agent: Pick<SpecialistConfig, 'id'>,
): ToolExecutionContext & { actor: SpecialistActor } {
  return {
    userId: base.userId,
    conversationId: base.conversationId,
    local: base.local,
    actor: `specialist:${agent.id}`,
    autoApproved: false,
  }
}

/**
 * Wrap the real dispatcher (executeTool) so a specialist can call only the
 * tools on its allow-list. Anything else — including delegating to another
 * agent — is refused before it reaches the dispatcher.
 */
export function buildSpecialistExecutor(
  agent: Pick<SpecialistConfig, 'name' | 'tools'>,
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  log?: (entry: ToolLogEntry) => void,
): (tool: string, args: Record<string, unknown>) => Promise<unknown> {
  const allowed = new Set(agent.tools)
  return async (tool, args) => {
    if (tool === 'delegate_to_agent' || !allowed.has(tool)) {
      log?.({ tool, args, refused: true })
      return {
        error: `The ${agent.name} is not allowed to use "${tool}". Recommend it in your report instead; the AI Manager decides.`,
        refused: true,
      }
    }
    try {
      const result = await execute(tool, args)
      const error = result && typeof result === 'object' && 'error' in result ? String((result as { error: unknown }).error) : undefined
      log?.({ tool, args, error, resultPreview: JSON.stringify(result ?? null).slice(0, 400) })
      return result
    } catch (err) {
      log?.({ tool, args, error: err instanceof Error ? err.message : 'Tool failed' })
      throw err
    }
  }
}

/** The definitions of the tools this specialist may call, and nothing else. */
export function specialistToolDefinitions(agent: Pick<SpecialistConfig, 'tools'>, all: ToolDefinition[]): ToolDefinition[] {
  const allowed = new Set(agent.tools)
  return all.filter((t) => allowed.has(t.function.name) && t.function.name !== 'delegate_to_agent')
}

export type ReportParse = { ok: true; report: SpecialistReport } | { ok: false; error: string }

/**
 * Pull the report out of a specialist's final reply: the ```report block, or
 * failing that the last JSON object in the text. Validated against the shared
 * schema; anything that does not match is rejected, never half-stored.
 */
export function parseSpecialistReport(text: string): ReportParse {
  if (!text || !text.trim()) return { ok: false, error: 'The specialist returned an empty reply.' }

  const block = text.match(/```report\s*([\s\S]*?)```/)
  const candidate = block ? block[1].trim() : extractJson(text)

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    return { ok: false, error: 'The report was not valid JSON.' }
  }

  const result = specialistReportSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: `The report did not match the required shape: ${issues}` }
  }
  return { ok: true, report: result.data }
}
