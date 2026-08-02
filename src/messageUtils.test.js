import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeMessages } from './messageUtils.js'

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
