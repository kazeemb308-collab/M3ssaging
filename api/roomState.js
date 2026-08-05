import { createHash } from 'node:crypto'

const messagesStore = new Map()
const presenceStore = new Map()
const eventStreams = new Map()

export function normalizeRoomId(roomId) {
  return String(roomId || 'default').trim().toLowerCase().replace(/\s+/g, '-') || 'default'
}

export function getRoomMessages(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId)
  return messagesStore.get(normalizedRoomId) || []
}

export function saveRoomMessages(roomId, messages) {
  const normalizedRoomId = normalizeRoomId(roomId)
  messagesStore.set(normalizedRoomId, messages)
  return messages
}

export function getRoomPresence(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId)
  return presenceStore.get(normalizedRoomId) || {}
}

export function upsertRoomPresence(roomId, senderId, nextPresence = {}) {
  if (!senderId) {
    return getRoomPresence(roomId)
  }

  const normalizedRoomId = normalizeRoomId(roomId)
  const currentPresence = getRoomPresence(normalizedRoomId)

  const nextSnapshot = {
    ...currentPresence,
    [senderId]: {
      online: Boolean(nextPresence.online),
      lastActive: Number(nextPresence.lastActive || Date.now()),
    },
  }

  presenceStore.set(normalizedRoomId, nextSnapshot)
  return nextSnapshot
}

export function getRoomEventStreams(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId)
  const currentStreams = eventStreams.get(normalizedRoomId)
  if (currentStreams) {
    return currentStreams
  }

  const nextStreams = new Set()
  eventStreams.set(normalizedRoomId, nextStreams)
  return nextStreams
}

export function emitRoomEvent(roomId, payload) {
  const normalizedRoomId = normalizeRoomId(roomId)
  const streams = getRoomEventStreams(normalizedRoomId)
  const serializedPayload = JSON.stringify(payload)

  for (const stream of [...streams]) {
    try {
      stream.write(`event: message\ndata: ${serializedPayload}\n\n`)
    } catch {
      // best-effort only
    }
  }
}

export function buildIdentitySet(messageIds = []) {
  return new Set((Array.isArray(messageIds) ? messageIds : []).flatMap((messageId) => {
    if (typeof messageId === 'string') {
      return [messageId]
    }

    return [messageId?.id, messageId?.clientId, messageId?.localId, messageId?.tempId].filter(Boolean)
  }))
}

export function messageMatchesIdentity(message = {}, candidate = []) {
  if (!Array.isArray(candidate) || !candidate.length) {
    return false
  }

  const identityCandidates = buildIdentitySet(candidate)
  return identityCandidates.has(message?.id)
    || identityCandidates.has(message?.clientId)
    || identityCandidates.has(message?.localId)
    || identityCandidates.has(message?.tempId)
}

export function applyDeliveredReceipts(messages = [], messageIds = [], delivered = true) {
  return messages.map((message) => {
    if (!messageMatchesIdentity(message, messageIds)) {
      return message
    }

    return {
      ...message,
      read: false,
      delivered: Boolean(delivered),
      status: delivered ? 'delivered' : message?.status || 'sent',
    }
  })
}

export function applyReadReceipts(messages = [], messageIds = [], read = true) {
  return messages.map((message) => {
    if (!messageMatchesIdentity(message, messageIds)) {
      return message
    }

    return {
      ...message,
      read: Boolean(read),
      delivered: Boolean(read || message?.delivered),
      status: read ? 'seen' : message?.status || 'sent',
    }
  })
}

export function createMessageRecord({
  message,
  clientId,
  senderId,
  senderName,
  messageType,
  attachment,
  timestamp,
  read,
  status,
  delivered,
  replyTo,
}) {
  return {
    id: createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex'),
    clientId: clientId || null,
    senderId: senderId || 'unknown',
    senderName: senderName || 'Unknown',
    text: String(message || '').trim(),
    messageType: String(messageType || 'text'),
    attachment: attachment || null,
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
    read: Boolean(read),
    delivered: Boolean(delivered || status === 'delivered' || status === 'seen'),
    status: String(status || 'sent'),
    replyTo: replyTo || null,
  }
}
