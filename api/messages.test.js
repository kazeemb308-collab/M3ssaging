import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDeliveredReceipts, applyReadReceipts } from './messages.js'

test('marks matching message ids as read without changing unrelated messages', () => {
  const messages = [
    { id: 'msg-1', text: 'Hello', read: false },
    { id: 'msg-2', text: 'World', read: false },
    { id: 'msg-3', text: 'Again', read: true },
  ]

  const result = applyReadReceipts(messages, ['msg-1', 'msg-2'], true)

  assert.deepEqual(result, [
    { id: 'msg-1', text: 'Hello', read: true, delivered: true, status: 'seen' },
    { id: 'msg-2', text: 'World', read: true, delivered: true, status: 'seen' },
    { id: 'msg-3', text: 'Again', read: true },
  ])
})

test('marks matching message ids as delivered without immediately marking them as seen', () => {
  const messages = [
    { id: 'msg-1', text: 'Hello', read: false, delivered: false, status: 'sent' },
    { id: 'msg-2', text: 'World', read: false, delivered: false, status: 'sent' },
  ]

  const result = applyDeliveredReceipts(messages, ['msg-1'])

  assert.deepEqual(result, [
    { id: 'msg-1', text: 'Hello', read: false, delivered: true, status: 'delivered' },
    { id: 'msg-2', text: 'World', read: false, delivered: false, status: 'sent' },
  ])
})
