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
