import test from 'node:test'
import assert from 'node:assert/strict'
import { applyReadReceipts, mergeMessages } from './messageUtils.js'

test('deduplicates optimistic messages when the server resolves them with the same clientId', () => {
  const optimisticMessage = {
    id: 'local-1',
    clientId: 'client-1',
    senderId: 'me',
    senderName: 'Me',
    text: 'Hello',
    timestamp: 100,
    read: false,
  }

  const serverMessage = {
    id: 'server-1',
    clientId: 'client-1',
    senderId: 'me',
    senderName: 'Me',
    text: 'Hello',
    timestamp: 100,
    read: true,
  }

  const result = mergeMessages([optimisticMessage], [serverMessage])

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'server-1')
  assert.equal(result[0].clientId, 'client-1')
  assert.equal(result[0].read, true)
})

test('marks matching message ids as read without mutating unrelated messages', () => {
  const messages = [
    { id: 'msg-1', text: 'Hello', read: false },
    { id: 'msg-2', text: 'World', read: false },
    { id: 'msg-3', text: 'Again', read: false },
  ]

  const result = applyReadReceipts(messages, ['msg-1', 'msg-3'])

  assert.deepEqual(result, [
    { id: 'msg-1', text: 'Hello', read: true },
    { id: 'msg-2', text: 'World', read: false },
    { id: 'msg-3', text: 'Again', read: true },
  ])
})
