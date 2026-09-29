/**
 * Turning a tool result into lessons — pure, so it is tested directly.
 *
 * A failure becomes a pitfall keyed by a signature, so the tenth "no payment
 * method" is one lesson seen ten times, not ten memories. A later success of
 * the same tool resolves that tool's pitfalls: the AI then knows both that it
 * failed and that it works now, which is what stops it warning forever about
 * something the owner already fixed.
 */

export interface PitfallLesson {
  signature: string
  statement: string
  detail: Record<string, unknown>
}

export interface OutcomeLessons {
  pitfalls: PitfallLesson[]
  /** Resolve active pitfalls whose signature starts with any of these… */
  resolvePrefixes?: string[]
  /** …except these, which are still failing. */
  keepSignatures?: string[]
}

/** Stable text for a signature: no ids, numbers, URLs or quoted names. */
export function normalizeError(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/"[^"]{1,80}"/g, '<name>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/[^\p{L}\p{N}<> ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

/** The failure a result reports, if any. Queued approvals are not failures. */
export function failureText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if (r.needsApproval) return null
  if (r.blocked === true && r.reason === 'not_ready') return null // handled per blocker
  if (r.blocked === true) return String(r.message || r.reason || 'Blocked')
  if (typeof r.error === 'string' && r.error) return r.error
  if (r.error && typeof r.error === 'object') return JSON.stringify(r.error).slice(0, 300)
  if (r.success === false) {
    const warnings = Array.isArray(r.warnings) ? (r.warnings as unknown[]).map(String).filter((w) => /rejected|failed|not published/i.test(w)) : []
    return [String(r.message || 'Failed'), ...warnings].join(' ').slice(0, 500)
  }
  return null
}

interface ReadinessLike {
  ready: boolean
  blockers: Array<{ code: string; problem: string; fix: string; link?: string }>
}

function readinessLessons(r: ReadinessLike): OutcomeLessons {
  const pitfalls = r.blockers.map((b) => ({
    signature: `readiness:${b.code}`,
    statement: `${b.problem} Fix: ${b.fix}`,
    detail: { code: b.code, link: b.link ?? null },
  }))
  return { pitfalls, resolvePrefixes: ['readiness:'], keepSignatures: pitfalls.map((p) => p.signature) }
}

export function lessonsFromResult(tool: string, result: unknown): OutcomeLessons {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>

  // Readiness is the richest signal: every blocker is its own lesson, and
  // every blocker no longer present has been fixed.
  if (r.blocked === true && r.reason === 'not_ready' && r.readiness) return readinessLessons(r.readiness as ReadinessLike)
  if (tool === 'check_publish_readiness' && Array.isArray(r.blockers)) return readinessLessons(r as unknown as ReadinessLike)

  const failure = failureText(result)
  if (failure) {
    return {
      pitfalls: [{
        signature: `${tool}:${normalizeError(failure)}`,
        statement: `${tool} failed: ${failure.slice(0, 400)}`,
        detail: { tool },
      }],
    }
  }
  if (r.needsApproval) return { pitfalls: [] }
  // It worked: this tool's earlier failures are behind us. A successful
  // publish also means every readiness blocker is gone.
  if (tool === 'publish_full_campaign' || tool === 'publish_campaign_to_meta') {
    return { pitfalls: [], resolvePrefixes: [`${tool}:`, 'readiness:'] }
  }
  return { pitfalls: [], resolvePrefixes: [`${tool}:`] }
}
