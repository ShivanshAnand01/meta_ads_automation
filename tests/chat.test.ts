import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanAssistantContent, displayUserContent } from '../src/components/chat/chat-message'
import { stepLabel } from '../src/components/chat/tool-steps'

test('cleanup keeps fenced code, including JSON the agent shows on purpose', () => {
  const md = 'Here:\n\n```json\n{ "headline": "x", "cta": "LEARN_MORE" }\n```\n\nDone.'
  assert.equal(cleanAssistantContent(md), md)
})

test('cleanup still strips stray raw tool output outside code', () => {
  assert.equal(cleanAssistantContent('Result below\n{"status":"ok","data":1}\n"status": "done"\nThanks'), 'Result below\n\nThanks')
  assert.equal(cleanAssistantContent('a {{{ raw dump }}} b'), 'a  b')
})

test('an unterminated fence mid-stream is protected too', () => {
  assert.equal(cleanAssistantContent('Streaming ```js\n{ a: 1 }'), 'Streaming ```js\n{ a: 1 }')
})

test('step labels read as actions, present while running and past when done', () => {
  assert.equal(stepLabel('sync_campaign_insights', 'pending'), 'Syncing campaign results…')
  assert.equal(stepLabel('sync_campaign_insights', 'done'), 'Synced campaign results')
  assert.equal(stepLabel('some_new_tool', 'done'), 'Some new tool')
})

test('the attachment note appended for the model is hidden from the owner', () => {
  assert.equal(displayUserContent('Look at this\n\n[Attached: a.png]'), 'Look at this')
  assert.equal(displayUserContent('No attachment'), 'No attachment')
})
