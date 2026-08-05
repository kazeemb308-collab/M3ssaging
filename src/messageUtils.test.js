import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDeliveredReceipts, applyReadReceipts, getMessageReactionSummary, getMessageStatus, getPresenceLabel, isPresenceFresh, mergeMessages, mergeRemoteMessageSet, persistMessages, retryAsync, toggleMessageReaction, updateMessageByIdentity } from './messageUtils.js'

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

test('merges incoming room payloads without dropping existing history or empty entries', () => {
  const existing = [
    { id: 'welcome', senderId: 'system', senderName: 'M3ssaging', text: 'Welcome', timestamp: 1 },
  ]

  const incoming = [
    { id: 'msg-1', senderId: 'them', senderName: 'Them', text: 'Hi there', timestamp: 2 },
    null,
    undefined,
    { id: 'msg-2', senderId: 'me', senderName: 'Me', text: 'Hey', timestamp: 3 },
  ]

  const result = mergeRemoteMessageSet(existing, incoming)

  assert.equal(result.length, 3)
  assert.deepEqual(result.map((message) => message.id), ['welcome', 'msg-1', 'msg-2'])
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

test('marks matching message ids as delivered without promoting them to seen', () => {
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

test('matches receipts by clientId when ids are not yet assigned', () => {
  const messages = [
    { id: 'local-1', clientId: 'client-1', text: 'Hello', read: false },
    { id: 'local-2', clientId: 'client-2', text: 'World', read: false },
  ]

  const result = applyReadReceipts(messages, ['client-1'])

  assert.equal(result[0].read, true)
  assert.equal(result[0].status, 'seen')
  assert.equal(result[1].read, false)
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

test('preserves an already-delivered status when partial server data clears the flags', () => {
  const optimisticMessage = {
    id: 'local-1',
    clientId: 'client-1',
    senderId: 'me',
    senderName: 'Me',
    text: 'Hello',
    timestamp: 100,
    read: true,
    delivered: true,
    status: 'seen',
  }

  const serverMessage = {
    id: 'server-1',
    clientId: 'client-1',
    senderId: 'me',
    senderName: 'Me',
    text: 'Hello',
    timestamp: 100,
    read: null,
    delivered: null,
    status: null,
  }

  const result = mergeMessages([optimisticMessage], [serverMessage])

  assert.equal(result.length, 1)
  assert.equal(result[0].read, true)
  assert.equal(result[0].delivered, true)
  assert.equal(result[0].status, 'seen')
})

test('derives WhatsApp-like statuses from delivery and read state', () => {
  assert.equal(getMessageStatus({ read: false, delivered: false }), 'sent')
  assert.equal(getMessageStatus({ read: false, delivered: true }), 'delivered')
  assert.equal(getMessageStatus({ read: true }), 'seen')
})

test('adds and removes a user reaction without duplicating it', () => {
  const baseMessage = {
    id: 'msg-1',
    senderId: 'them',
    senderName: 'Them',
    text: 'Hello',
    reactions: [
      { emoji: '👍', senderId: 'me' },
      { emoji: '❤️', senderId: 'them' },
    ],
  }

  const withReaction = toggleMessageReaction(baseMessage, '😂', 'me')
  assert.equal(withReaction.reactions.filter((reaction) => reaction.emoji === '😂' && reaction.senderId === 'me').length, 1)

  const withoutReaction = toggleMessageReaction(withReaction, '👍', 'me')
  assert.equal(withoutReaction.reactions.some((reaction) => reaction.emoji === '👍' && reaction.senderId === 'me'), false)
})

test('summarizes reactions for the WhatsApp-style picker without rendering them inline', () => {
  const message = {
    id: 'msg-1',
    reactions: [
      { emoji: '👍', senderId: 'me' },
      { emoji: '👍', senderId: 'them' },
      { emoji: '❤️', senderId: 'them' },
    ],
  }

  const summary = getMessageReactionSummary(message, 'me')

  assert.deepEqual(summary, [
    { emoji: '👍', count: 2, active: true },
    { emoji: '❤️', count: 1, active: false },
  ])
})

test('preserves the current conversation when a reaction target cannot be matched', () => {
  const currentMessages = [
    { id: 'msg-1', text: 'Hello' },
    { id: 'msg-2', text: 'World' },
  ]

  const result = updateMessageByIdentity(currentMessages, { id: 'missing' }, { reactions: [{ emoji: '👍', senderId: 'me' }] })

  assert.deepEqual(result, currentMessages)
})

test('keeps the most recent reaction state instead of clearing it with a stale empty payload', () => {
  const currentMessages = [{
    id: 'msg-1',
    text: 'Hello',
    reactions: [{ emoji: '👍', senderId: 'me' }],
    updatedAt: 200,
  }]

  const staleIncoming = [{
    id: 'msg-1',
    text: 'Hello',
    reactions: [],
    updatedAt: 100,
  }]

  const result = mergeMessages(currentMessages, staleIncoming)

  assert.deepEqual(result[0].reactions, [{ emoji: '👍', senderId: 'me' }])
})

test('retries transient async failures and eventually succeeds', async () => {
  let attempts = 0
  const result = await retryAsync(async () => {
    attempts += 1
    if (attempts < 3) {
      throw new Error('transient')
    }

    return 'ok'
  }, { retries: 3, delayMs: 0 })

  assert.equal(result, 'ok')
  assert.equal(attempts, 3)
})

test('supports sending and failed network states for outgoing messages', () => {
  assert.equal(getMessageStatus({ status: 'sending' }), 'sending')
  assert.equal(getMessageStatus({ status: 'failed' }), 'failed')
})

test('treats stale presence heartbeat as offline instead of online', () => {
  const now = 1_000_000
  assert.equal(isPresenceFresh({ online: true, lastActive: now - 30_000 }, now), true)
  assert.equal(isPresenceFresh({ online: true, lastActive: now - 90_000 }, now), false)
  assert.equal(isPresenceFresh({ online: false, lastActive: now - 10_000 }, now), false)
})

test('formats a stable online or last-active label using the real timestamp delta', () => {
  const now = 1_000_000
  assert.equal(getPresenceLabel({ online: true, lastActive: now - 30_000 }, now), 'online')
  assert.equal(getPresenceLabel({ online: true, lastActive: now - 90_000 }, now), 'last active 1m ago')
  assert.equal(getPresenceLabel({ online: false, lastActive: now - 10_000 }, now), 'last active just now')
})
