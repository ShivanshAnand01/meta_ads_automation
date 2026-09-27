import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROVIDERS, customSlug, validateCustomUrl, getProvider } from '../src/lib/integrations/catalog'
import { needsApproval, classifyRisk, requiresApprovalAlways } from '../src/lib/ai/guardrails'
import { ALL_TOOL_NAMES } from '../src/lib/ai/tool-definitions'

test('research and listing run without approval; paid tool calls need it', () => {
  assert.equal(needsApproval('research_web', false), false)
  assert.equal(needsApproval('list_connected_tools', false), false)
  assert.equal(needsApproval('call_connected_tool', false), true)
  // With auto-optimize the agent may call connected tools, like other medium-risk actions.
  assert.equal(needsApproval('call_connected_tool', true), false)
  assert.equal(requiresApprovalAlways('call_connected_tool'), false)
  assert.equal(classifyRisk('call_connected_tool'), 'medium')
  assert.equal(classifyRisk('research_web'), 'low')
})

test('the agent is offered the integration tools', () => {
  for (const name of ['research_web', 'list_connected_tools', 'call_connected_tool']) {
    assert.ok(ALL_TOOL_NAMES.includes(name), name)
  }
})

test('custom MCP URLs must be public https', () => {
  assert.equal(validateCustomUrl('https://mcp.example.com/mcp'), null)
  assert.match(validateCustomUrl('http://mcp.example.com/mcp') || '', /https/)
  for (const bad of ['https://localhost:3000', 'https://127.0.0.1/x', 'https://10.0.0.5', 'https://192.168.1.1', 'https://172.20.0.1', 'https://169.254.169.254/latest']) {
    assert.ok(validateCustomUrl(bad), bad)
  }
  assert.ok(validateCustomUrl('not a url'))
})

test('custom slugs are stable and URL-safe', () => {
  assert.equal(customSlug('My CRM!'), 'custom-my-crm')
  assert.equal(customSlug('   '), 'custom-server')
  assert.match(customSlug('x'.repeat(100)), /^custom-x{40}$/)
})

test('every catalog provider can be connected at least one way', () => {
  const ids = new Set<string>()
  for (const p of PROVIDERS) {
    assert.ok(p.api || p.mcp, `${p.id} has no connection mode`)
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`)
    ids.add(p.id)
    if (p.mcp) assert.ok(p.mcp.url.startsWith('https://'), p.id)
  }
  assert.equal(getProvider('tavily')?.mcp?.auth.kind, 'query')
})
