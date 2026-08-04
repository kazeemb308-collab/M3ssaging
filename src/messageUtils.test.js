import test from 'node:test'
import assert from 'node:assert/strict'
import { applyReadReceipts, getMessageStatus, mergeMessages, persistMessages } from './messageUtils.js'

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
    { id: 'msg-1', text: 'Hello', read: true, delivered: true, status: 'seen' },
    { id: 'msg-2', text: 'World', read: false },
    { id: 'msg-3', text: 'Again', read: true, delivered: true, status: 'seen' },
  ])
})

test('keeps attachment data in storage while preserving message metadata', () => {
  const storage = {
    values: new Map(),
    setItem(key, value) {
      this.values.set(key, value)
    },
    getItem(key) {
      return this.values.get(key) || null
    },
    removeItem(key) {
      this.values.delete(key)
    },
  }

  const messages = [
    {
      id: 'msg-1',
      text: 'Photo',
      attachment: {
        name: 'photo.png',
        type: 'image/png',
        data: 'data:image/png;base64,AAAA',
      },
    },
  ]

  const persisted = persistMessages('room-1', messages, storage)

  assert.equal(persisted, true)
  const storedMessages = JSON.parse(storage.getItem('m3ssaging-messages:room-1'))
  assert.equal(storedMessages[0].attachment?.data, 'data:image/png;base64,AAAA')
  assert.equal(storedMessages[0].attachment?.name, 'photo.png')
})

test('preserves optimistic reply metadata and delivery status when server data is less detailed', () => {
  const optimisticMessage = {
    id: 'local-1',
    clientId: 'client-1',
    senderId: 'me',
    senderName: 'Me',
    text: 'Hello',
    timestamp: 100,
    read: false,
    delivered: true,
    status: 'delivered',
    replyTo: {
      id: 'msg-7',
      senderName: 'Them',
      text: 'Original message',
      messageType: 'text',
    },
  }

  const serverMessage = {
    id: 'server-1',
    clientId: 'client-1',
    senderId: 'me',
    senderName: 'Me',
    text: 'Hello',
    timestamp: 100,
    read: false,
    delivered: false,
    status: 'sent',
    replyTo: null,
  }

  const result = mergeMessages([optimisticMessage], [serverMessage])

  assert.equal(result.length, 1)
  assert.equal(result[0].replyTo?.id, 'msg-7')
  assert.equal(result[0].status, 'delivered')
  assert.equal(result[0].delivered, true)
})

test('derives WhatsApp-like statuses from delivery and read state', () => {
  assert.equal(getMessageStatus({ read: false, delivered: false }), 'sent')
  assert.equal(getMessageStatus({ read: false, delivered: true }), 'delivered')
  assert.equal(getMessageStatus({ read: true }), 'seen')
})
