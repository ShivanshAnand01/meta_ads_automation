import test from 'node:test'
import assert from 'node:assert/strict'
import { needsApproval, classifyRisk, SAFE_TOOLS, APPROVAL_TOOLS, requiresApprovalAlways } from '../src/lib/ai/guardrails.ts'
import { toMinorUnits, fromMinorUnits } from '../src/lib/meta/client.ts'
import { truncateForMeta, META_LIMITS, extractJson, enforceCopyLimits } from '../src/lib/ai/structured.ts'
import { resolveGptImageSize, ASPECT_RATIO_DIMENSIONS } from '../src/lib/ai/image-generator.ts'

// ── Guardrails ────────────────────────────────────────────────────────────

test('an unknown tool requires approval (fails closed)', () => {
  // This used to return false — every unrecognised tool could move live ad
  // spend with no review at all.
  assert.equal(needsApproval('some_tool_we_have_never_seen', false), true)
  assert.equal(classifyRisk('some_tool_we_have_never_seen'), 'high')
})

test('read-only tools never need approval', () => {
  for (const tool of ['get_insights', 'list_campaigns', 'get_dashboard_summary', 'list_ad_sets']) {
    assert.equal(needsApproval(tool, false), false, `${tool} should be safe`)
  }
})

test('spend-affecting tools need approval unless auto-optimize is on', () => {
  for (const tool of ['create_campaign', 'resume_campaign', 'update_campaign_budget', 'create_ad_set', 'create_ad']) {
    assert.equal(needsApproval(tool, false), true, `${tool} should need approval`)
    assert.equal(needsApproval(tool, true), false, `${tool} should pass with auto-optimize`)
  }
})

test('destructive and strategy-rewriting actions always need approval', () => {
  for (const tool of ['delete_local_campaign', 'delete_local_creative', 'update_strategy']) {
    assert.equal(requiresApprovalAlways(tool), true, `${tool} must always be approved`)
  }
  assert.equal(requiresApprovalAlways('create_campaign'), false)
})

test('no tool is both safe and approval-gated', () => {
  for (const tool of SAFE_TOOLS) {
    assert.ok(!APPROVAL_TOOLS.has(tool), `${tool} is in both SAFE_TOOLS and APPROVAL_TOOLS`)
  }
})

test('anything that starts or scales live delivery is high risk', () => {
  for (const tool of ['resume_campaign', 'update_campaign_budget', 'publish_full_campaign', 'set_ad_status']) {
    assert.equal(classifyRisk(tool), 'high', `${tool} should be high risk`)
  }
})

// ── Currency ──────────────────────────────────────────────────────────────

test('budgets convert to and from minor units', () => {
  assert.equal(toMinorUnits(500, 'INR'), 50_000)
  assert.equal(fromMinorUnits('50000', 'INR'), 500)
  assert.equal(toMinorUnits(1234.56, 'INR'), 123_456)
})

test('zero-decimal currencies are not multiplied', () => {
  // ¥500 is 500 minor units, not 50,000 — getting this wrong overspends 100x.
  assert.equal(toMinorUnits(500, 'JPY'), 500)
  assert.equal(fromMinorUnits('500', 'JPY'), 500)
})

test('malformed budget values do not become NaN', () => {
  assert.equal(fromMinorUnits(null), 0)
  assert.equal(fromMinorUnits(undefined), 0)
  assert.equal(fromMinorUnits('not-a-number'), 0)
})

// ── Image sizing ──────────────────────────────────────────────────────────

test('portrait ratios map to a portrait size and landscape to landscape', () => {
  // These were inverted: 4:5 (portrait) produced a landscape image and 1.91:1
  // (landscape) produced a portrait one, so every feed-portrait and link ad
  // came out the wrong shape and got cropped by Meta.
  assert.equal(resolveGptImageSize({ aspectRatio: '4:5' }), '1024x1536')
  assert.equal(resolveGptImageSize({ aspectRatio: '9:16' }), '1024x1536')
  assert.equal(resolveGptImageSize({ aspectRatio: '1.91:1' }), '1536x1024')
  assert.equal(resolveGptImageSize({ aspectRatio: '16:9' }), '1536x1024')
  assert.equal(resolveGptImageSize({ aspectRatio: '1:1' }), '1024x1024')
})

test('declared dimensions match their aspect ratio', () => {
  for (const [ratio, { w, h }] of Object.entries(ASPECT_RATIO_DIMENSIONS)) {
    const [rw, rh] = ratio.split(':').map(Number)
    const expected = rw / rh
    const actual = w / h
    assert.ok(Math.abs(expected - actual) < 0.02, `${ratio} declares ${w}x${h} (${actual.toFixed(3)} vs ${expected.toFixed(3)})`)
  }
})

// ── Ad copy limits ────────────────────────────────────────────────────────

test('copy over Meta limits is truncated', () => {
  const long = 'a'.repeat(200)
  const result = truncateForMeta(long, META_LIMITS.primaryText)
  assert.equal(result.truncated, true)
  assert.ok([...result.text].length <= META_LIMITS.primaryText + 1)
})

test('copy within limits is untouched', () => {
  const short = 'मराठी विक्री ईबुक'
  const result = truncateForMeta(short, META_LIMITS.headline)
  assert.equal(result.truncated, false)
  assert.equal(result.text, short)
})

test('Devanagari is counted by character, not byte', () => {
  // 30 Devanagari characters are ~90 UTF-8 bytes; a byte-based check would
  // truncate valid copy.
  const devanagari = 'न'.repeat(30)
  assert.equal(truncateForMeta(devanagari, 40).truncated, false)
})

test('enforceCopyLimits reports what it cut', () => {
  const result = enforceCopyLimits({
    primaryText: 'x'.repeat(200),
    headline: 'y'.repeat(100),
  })
  assert.equal(result.copyWarnings.length, 2)
})

// ── LLM JSON extraction ───────────────────────────────────────────────────

test('JSON is extracted from fenced and prefixed model output', () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(extractJson('```\n{"a":1}\n```'), '{"a":1}')
  assert.equal(extractJson('Here is the JSON:\n{"a":1}'), '{"a":1}')
  assert.equal(extractJson('{"a":1}\nHope that helps!'), '{"a":1}')
  assert.equal(extractJson('  {"a":1}  '), '{"a":1}')
})
