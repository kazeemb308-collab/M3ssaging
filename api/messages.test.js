import test from 'node:test'
import assert from 'node:assert/strict'
import { applyReadReceipts } from './messages.js'

test('marks matching message ids as read without changing unrelated messages', () => {
  const messages = [
    { id: 'msg-1', text: 'Hello', read: false },
    { id: 'msg-2', text: 'World', read: false },
    { id: 'msg-3', text: 'Again', read: true },
  ]

  const result = applyReadReceipts(messages, ['msg-1', 'msg-2'], true)

  assert.deepEqual(result, [
    { id: 'msg-1', text: 'Hello', read: true },
    { id: 'msg-2', text: 'World', read: true },
    { id: 'msg-3', text: 'Again', read: true },
  ])
})
