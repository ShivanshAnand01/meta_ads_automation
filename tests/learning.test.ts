import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeError, failureText, lessonsFromResult } from '../src/lib/ai/learning/outcome.ts'
import { formatLearningContext } from '../src/lib/ai/learning/context.ts'
import { preferenceSchema } from '../src/lib/ai/learning/preferences.ts'
import { retrospectiveSchema } from '../src/lib/ai/learning/retrospective.ts'
import type { Learning } from '../src/lib/ai/learning/store.ts'

// ── Signatures: the same failure is one lesson, however it is worded ─────

test('the same Meta failure with different ids and names normalises to one signature', () => {
  const a = normalizeError('Creative "AI eBook Sales" was not published: campaign 120248677518630240 failed at https://x.example/a?b=1')
  const b = normalizeError('Creative "Diwali offer" was not published: campaign 99 failed at https://y.example/z')
  assert.equal(a, b)
})

test('queued approvals and readiness blocks are not generic failures', () => {
  assert.equal(failureText({ needsApproval: true, approvalId: 'x' }), null)
  assert.equal(failureText({ blocked: true, reason: 'not_ready', readiness: { ready: false, blockers: [] } }), null)
  assert.match(String(failureText({ success: false, message: 'Every ad failed', warnings: ['Creative X was not published: Meta rejected the request'] })), /Every ad failed.*rejected/)
})

// ── Outcomes → lessons ───────────────────────────────────────────────────

test('a failed tool becomes a pitfall; a later success resolves only that tool', () => {
  const fail = lessonsFromResult('create_ad', { error: 'Meta rejected the request: Invalid parameter' })
  assert.equal(fail.pitfalls.length, 1)
  assert.match(fail.pitfalls[0].signature, /^create_ad:/)

  const ok = lessonsFromResult('create_ad', { id: '123' })
  assert.deepEqual(ok.pitfalls, [])
  assert.deepEqual(ok.resolvePrefixes, ['create_ad:'])
})

test('each readiness blocker is its own lesson, and blockers no longer present are resolved', () => {
  const r = lessonsFromResult('publish_full_campaign', {
    blocked: true, reason: 'not_ready',
    readiness: { ready: false, blockers: [{ code: 'no_payment_method', problem: 'No payment method.', fix: 'Add one.' }] },
  })
  assert.deepEqual(r.pitfalls.map((p) => p.signature), ['readiness:no_payment_method'])
  assert.deepEqual(r.resolvePrefixes, ['readiness:'])
  assert.deepEqual(r.keepSignatures, ['readiness:no_payment_method'])
})

test('a successful publish clears publish and readiness problems, and nothing else', () => {
  const r = lessonsFromResult('publish_full_campaign', { success: true, metaAdIds: ['1'] })
  assert.deepEqual(r.resolvePrefixes, ['publish_full_campaign:', 'readiness:'])
})

test('a queued approval teaches nothing yet', () => {
  assert.deepEqual(lessonsFromResult('create_campaign', { needsApproval: true }), { pitfalls: [] })
})

// ── The prompt block ─────────────────────────────────────────────────────

const L = (over: Partial<Learning>): Learning => ({
  id: Math.random().toString(36), userId: 'u', kind: 'pitfall', signature: 's', statement: 'x', detail: {}, source: 'tool_failure',
  occurrences: 1, confidence: 0.5, status: 'active', firstSeen: '2026-09-01', lastSeen: '2026-09-29', resolvedAt: null, ...over,
})

test('the learning block lists notes, preferences, open problems and recent fixes; dismissed ones never appear', () => {
  const now = Date.parse('2026-09-29T12:00:00Z')
  const text = formatLearningContext([
    L({ kind: 'operating_note', statement: 'Use Traffic until a Pixel exists.' }),
    L({ kind: 'owner_preference', statement: 'Write ads in Marathi.' }),
    L({ kind: 'pitfall', statement: 'No payment method. Fix: add one.', occurrences: 3 }),
    L({ kind: 'pitfall', status: 'resolved', resolvedAt: '2026-09-28T10:00:00Z', statement: 'App in Development mode. Fix: switch to Live.' }),
    L({ kind: 'owner_preference', status: 'dismissed', statement: 'SHOULD NOT APPEAR' }),
  ], now)
  assert.match(text, /working notes[\s\S]*Traffic/)
  assert.match(text, /owner wants[\s\S]*Marathi/)
  assert.match(text, /No payment method.*\(seen 3×\)/)
  assert.match(text, /Recently fixed[\s\S]*Development mode/)
  assert.doesNotMatch(text, /Fix: switch to Live/, 'fixed items drop their now-irrelevant fix')
  assert.doesNotMatch(text, /SHOULD NOT APPEAR/)
  assert.match(text, /never override the guardrails/)
})

test('nothing learned yet means no block at all', () => {
  assert.equal(formatLearningContext([]), '')
})

// ── Model output is validated, never trusted ────────────────────────────

test('preference and retrospective output must match the schema', () => {
  assert.equal(preferenceSchema.safeParse({ preferences: [{ topic: 'ad_language', statement: 'Write ads in Marathi.' }] }).success, true)
  assert.equal(preferenceSchema.safeParse({ preferences: [{ topic: 'Ad Language!', statement: 'x' }] }).success, false)
  assert.equal(retrospectiveSchema.safeParse({ operatingNotes: Array.from({ length: 9 }, (_, i) => ({ topic: `t${i}`, note: 'A rule with enough words.' })) }).success, false, 'at most 8 notes')
})
