import test from 'node:test'
import assert from 'node:assert/strict'
import { redactSecrets, REDACTED } from '../src/lib/redact.ts'

test('Meta credentials in tool arguments never reach the audit log', () => {
  const args = { app_id: '2240767766687942', app_secret: 'abc123secretvalue', access_token: 'EAAGverylongtoken' }
  assert.deepEqual(redactSecrets(args), { app_id: '2240767766687942', app_secret: REDACTED, access_token: REDACTED })
})

test('nested and array values are redacted too', () => {
  const result = { integration: { apiKey: 'tvly-xyz', headers: [{ Authorization: 'Bearer abc' }] }, name: 'tavily' }
  assert.deepEqual(redactSecrets(result), {
    integration: { apiKey: REDACTED, headers: [{ Authorization: REDACTED }] },
    name: 'tavily',
  })
})

test('numbers under a token-like key are counts, not secrets, and pass through', () => {
  assert.deepEqual(redactSecrets({ tokens: 1234, max_completion_tokens: 800 }), { tokens: 1234, max_completion_tokens: 800 })
})

test('the input object is not mutated', () => {
  const args = { access_token: 'EAAG' }
  redactSecrets(args)
  assert.equal(args.access_token, 'EAAG')
})

test('credentials pasted into chat text are blanked; ordinary text is not', async () => {
  const { redactSecretText } = await import('../src/lib/redact.ts')
  const msg = 'App secret 0123456789abcdef0123456789abcdef and token EAAGm0PX4ZCpsBAKZCkZAbcdefghijklmnop, key sk-proj-abcdefghijklmnop1234'
  const out = redactSecretText(msg)
  assert.equal(out.includes('0123456789abcdef'), false)
  assert.equal(out.includes('EAAG'), false)
  assert.equal(out.includes('sk-proj'), false)
  assert.equal(redactSecretText('Budget ₹500/day for Pune, ad account 1316138380606285'), 'Budget ₹500/day for Pune, ad account 1316138380606285')
})
