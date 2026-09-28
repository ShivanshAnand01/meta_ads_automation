import test from 'node:test'
import assert from 'node:assert/strict'
import { SPECIALISTS, AGENT_IDS, enabledSpecialists } from '../src/lib/ai/agents/registry.ts'
import {
  buildSpecialistExecutor, specialistToolContext, specialistToolDefinitions, parseSpecialistReport,
} from '../src/lib/ai/agents/specialist.ts'
import { SAFE_TOOLS, APPROVAL_TOOLS, mayExecuteWithoutApproval } from '../src/lib/ai/guardrails.ts'
import { ALL_TOOLS, ALL_TOOL_NAMES } from '../src/lib/ai/tool-definitions.ts'
import { costUsd } from '../src/lib/ai/pricing.ts'
import { modelForTier } from '../src/lib/ai/model-catalog.ts'

const research = SPECIALISTS.research

type Refusal = { refused?: boolean }

// ── Registry: what a specialist may ever touch ───────────────────────────

test('no specialist is ever given a tool that spends, publishes, deletes or delegates', () => {
  for (const id of AGENT_IDS) {
    for (const tool of SPECIALISTS[id].tools) {
      assert.equal(APPROVAL_TOOLS.has(tool), false, `${id} must not have approval tool ${tool}`)
      assert.equal(SAFE_TOOLS.has(tool), true, `${id} tool ${tool} must be on the SAFE list`)
      assert.notEqual(tool, 'delegate_to_agent', `${id} must not delegate`)
    }
  }
})

test('every tool on an allow-list is a real tool', () => {
  for (const id of AGENT_IDS) {
    for (const tool of SPECIALISTS[id].tools) {
      assert.ok(ALL_TOOL_NAMES.includes(tool), `${id} lists unknown tool ${tool}`)
    }
  }
})

test('the AI Manager gets delegate_to_agent, listing only enabled specialists', () => {
  const def = ALL_TOOLS.find((t) => t.function.name === 'delegate_to_agent')
  assert.ok(def, 'delegate_to_agent should exist while any specialist is enabled')
  const params = def!.function.parameters as { properties: { agent: { enum: string[] } } }
  const agentEnum = params.properties.agent.enum
  assert.deepEqual(agentEnum, enabledSpecialists().map((s) => s.id))
})

test('a specialist is only shown the tools on its allow-list', () => {
  const names = specialistToolDefinitions(research, ALL_TOOLS).map((t) => t.function.name).sort()
  assert.deepEqual(names, [...new Set(research.tools)].filter((t) => ALL_TOOL_NAMES.includes(t)).sort())
})

// ── The executor: every call goes through the real dispatcher, gated ────

test('an allowed tool goes through the dispatcher it was given (executeTool)', async () => {
  const calls: string[] = []
  const exec = buildSpecialistExecutor(research, async (tool) => { calls.push(tool); return { ok: true } })
  assert.deepEqual(await exec('research_web', { query: 'x' }), { ok: true })
  assert.deepEqual(calls, ['research_web'])
})

test('a spend tool requested by a specialist never reaches the dispatcher', async () => {
  const calls: string[] = []
  const log: Refusal[] = []
  const exec = buildSpecialistExecutor(research, async (tool) => { calls.push(tool); return {} }, (e) => log.push(e))
  const out = (await exec('create_campaign', { name: 'x', objective: 'OUTCOME_TRAFFIC' })) as Refusal
  assert.equal(out.refused, true)
  assert.equal(calls.length, 0)
  assert.equal(log[0].refused, true)
})

test('a specialist cannot delegate onward', async () => {
  const calls: string[] = []
  const exec = buildSpecialistExecutor({ name: 'x', tools: ['delegate_to_agent'] }, async (t) => { calls.push(t); return {} })
  assert.equal(((await exec('delegate_to_agent', { agent: 'research', brief: 'b' })) as Refusal).refused, true)
  assert.equal(calls.length, 0)
})

test('specialists run without auto-approval, under their own actor name', () => {
  const ctx = specialistToolContext({ userId: 'u', local: { userId: 'u', providerType: 'openai' } }, research)
  assert.equal(ctx.autoApproved, false)
  assert.equal(ctx.actor, 'specialist:research')
})

// ── The approval gate: specialists never outrank the AI Manager ─────────

test('a spend tool from a specialist is queued for approval even with auto-optimize on', () => {
  for (const tool of ['create_campaign', 'update_ad_set_budget', 'set_ad_status', 'publish_full_campaign']) {
    assert.equal(mayExecuteWithoutApproval({ tool, autoOptimize: true, autoApproved: true, actor: 'specialist:watcher' }), false, tool)
    assert.equal(mayExecuteWithoutApproval({ tool, autoOptimize: false, actor: 'specialist:watcher' }), false, tool)
  }
  // An unknown tool fails closed for a specialist as it does for everyone.
  assert.equal(mayExecuteWithoutApproval({ tool: 'mystery_tool', autoOptimize: true, actor: 'specialist:research' }), false)
})

test('the AI Manager\'s own approval behaviour is unchanged', () => {
  assert.equal(mayExecuteWithoutApproval({ tool: 'create_campaign', autoOptimize: false, actor: 'agent' }), false)
  assert.equal(mayExecuteWithoutApproval({ tool: 'create_campaign', autoOptimize: true, actor: 'agent' }), true)
  assert.equal(mayExecuteWithoutApproval({ tool: 'update_strategy', autoOptimize: true, autoApproved: true, actor: 'autonomous' }), false)
  assert.equal(mayExecuteWithoutApproval({ tool: 'research_web', autoOptimize: false, actor: 'specialist:research' }), true)
})

// ── Reports: validated, or rejected whole ────────────────────────────────

const good = { summary: 'Two competitors price at ₹199.', findings: [{ finding: 'A sells at ₹199', evidence: 'site', importance: 7, source: 'https://a.example' }], recommendations: ['Test a ₹149 offer'], openQuestions: [] }

test('a well-formed report in a report block is accepted', () => {
  const r = parseSpecialistReport(`Done.\n\`\`\`report\n${JSON.stringify(good)}\n\`\`\``)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.report.findings[0].importance, 7)
})

test('a malformed report is rejected, not half-stored', () => {
  assert.equal(parseSpecialistReport('I looked around and it seems fine.').ok, false)
  assert.equal(parseSpecialistReport('```report\n{"summary": "x", "findings": [\n```').ok, false)
  const noSummary = parseSpecialistReport(`\`\`\`report\n${JSON.stringify({ findings: [] })}\n\`\`\``)
  assert.equal(noSummary.ok, false)
  if (!noSummary.ok) assert.match(noSummary.error, /summary/)
  assert.equal(parseSpecialistReport('').ok, false)
})

// ── Cost ─────────────────────────────────────────────────────────────────

test('calls are priced from reported tokens; unknown models get no guessed price', () => {
  // gpt-5.4-mini: $0.75 in, $0.075 cached, $4.50 out per 1M tokens.
  assert.equal(costUsd('gpt-5.4-mini', { inputTokens: 10_000, cachedInputTokens: 4_000, outputTokens: 1_000 }), 0.0093)
  assert.equal(costUsd('some-future-model', { inputTokens: 1000, outputTokens: 1000 }), null)
})

test('background specialists use the economy model; others the business\'s own', () => {
  assert.equal(modelForTier('openai', 'gpt-5.5', 'economy'), 'gpt-5.4-mini')
  assert.equal(modelForTier('openai', 'gpt-5.5', 'owner'), 'gpt-5.5')
  assert.equal(modelForTier('groq', 'llama-3.3-70b-versatile', 'economy'), 'llama-3.3-70b-versatile')
})

test('the developer account sees every specialist; businesses only the enabled ones', async () => {
  const { toolsForUser } = await import('../src/lib/ai/tool-definitions.ts')
  const agentsIn = (developer: boolean) => {
    const def = toolsForUser(developer).filter((t) => t.function.name === 'delegate_to_agent')
    assert.equal(def.length, 1, 'exactly one delegate tool')
    return (def[0].function.parameters as { properties: { agent: { enum: string[] } } }).properties.agent.enum
  }
  assert.deepEqual(agentsIn(true), [...AGENT_IDS])
  assert.deepEqual(agentsIn(false), enabledSpecialists().map((s) => s.id))
})
