import { createHash } from 'node:crypto'

const store = new Map()
const presenceStore = new Map()

function normalizeRoomId(roomId) {
  return String(roomId || 'default').trim().toLowerCase().replace(/\s+/g, '-') || 'default'
}

function getRoomMessages(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId)
  return store.get(normalizedRoomId) || []
}

function saveRoomMessages(roomId, messages) {
  const normalizedRoomId = normalizeRoomId(roomId)
  store.set(normalizedRoomId, messages)
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

function buildMessageIdentitySignature(message = {}) {
  const senderId = message?.senderId || 'unknown'
  const text = String(message?.text || '').trim()
  const timestamp = Number(message?.timestamp || message?.createdAt || 0)
  return `${senderId}:${text}:${Number.isFinite(timestamp) ? timestamp : '0'}`
}

function messageMatchesIdentity(message = {}, candidate = []) {
  if (!Array.isArray(candidate) || !candidate.length) {
    return false
  }

  const identityCandidates = candidate.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry]
    }

    const directValues = [entry?.id, entry?.clientId, entry?.localId, entry?.tempId].filter(Boolean)
    return directValues.length ? directValues : [buildMessageIdentitySignature(entry)]
  })

  const fallbackKey = buildMessageIdentitySignature(message)
  return identityCandidates.includes(message?.id)
    || identityCandidates.includes(message?.clientId)
    || identityCandidates.includes(message?.localId)
    || identityCandidates.includes(message?.tempId)
    || identityCandidates.includes(fallbackKey)
}

export function applyDeliveredReceipts(messages = [], messageIds = [], delivered = true) {
  return messages.map((message) => {
    if (!Array.isArray(messageIds)) {
      return message
    }

    const matchesReceipt = messageIds.includes(message?.id)
      || messageIds.includes(message?.clientId)
      || messageIds.includes(message?.localId)
      || messageIds.includes(message?.tempId)

    if (!matchesReceipt) {
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
    if (!Array.isArray(messageIds)) {
      return message
    }

    const matchesReceipt = messageIds.includes(message?.id)
      || messageIds.includes(message?.clientId)
      || messageIds.includes(message?.localId)
      || messageIds.includes(message?.tempId)

    if (!matchesReceipt) {
      return message
    }

    return { ...message, read: Boolean(read), delivered: Boolean(read || message?.delivered), status: read ? 'seen' : message?.status || 'sent' }
  })
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const roomId = req.query.room || 'default'
    const wantsPresence = String(req.query.presence || '').toLowerCase() === '1' || String(req.query.presence || '').toLowerCase() === 'true'

    if (wantsPresence) {
      res.status(200).json(getRoomPresence(roomId))
      return
    }

    res.status(200).json(getRoomMessages(roomId))
    return
  }

  if (req.method === 'POST') {
    const {
      roomId,
      message,
      clientId,
      senderId,
      senderName,
      messageType,
      attachment,
      timestamp,
      readMessageIds,
      deliveredMessageIds,
      deleteMessageIds,
      updateMessage,
      read,
      status,
      delivered,
      replyTo,
      online,
      lastActive,
      presence,
    } = req.body || {}
    const normalizedRoomId = normalizeRoomId(roomId)
    const existingMessages = getRoomMessages(normalizedRoomId)

    if (typeof senderId === 'string' && (typeof online === 'boolean' || typeof lastActive === 'number' || typeof presence === 'object')) {
      const nextPresence = upsertRoomPresence(normalizedRoomId, senderId, presence || { online, lastActive })
      res.status(200).json(nextPresence)
      return
    }

    if (Array.isArray(deleteMessageIds)) {
      const nextMessages = existingMessages.filter((existingMessage) => !messageMatchesIdentity(existingMessage, deleteMessageIds))
      saveRoomMessages(normalizedRoomId, nextMessages)
      res.status(200).json(nextMessages)
      return
    }

    if (updateMessage && typeof updateMessage === 'object') {
      const nextMessages = existingMessages.map((existingMessage) => {
        if (!messageMatchesIdentity(existingMessage, [updateMessage.target])) {
          return existingMessage
        }

        return {
          ...existingMessage,
          text: typeof updateMessage.text === 'string' ? String(updateMessage.text).trim() : existingMessage.text,
          reactions: Array.isArray(updateMessage.reactions) ? updateMessage.reactions : existingMessage.reactions || [],
          edited: Boolean(updateMessage.edited || existingMessage.edited),
          updatedAt: typeof updateMessage.updatedAt === 'number' ? updateMessage.updatedAt : Date.now(),
        }
      })

      saveRoomMessages(normalizedRoomId, nextMessages)
      res.status(200).json(nextMessages)
      return
    }

    if (Array.isArray(deliveredMessageIds)) {
      const nextMessages = applyDeliveredReceipts(existingMessages, deliveredMessageIds, delivered)
      saveRoomMessages(normalizedRoomId, nextMessages)
      res.status(200).json(nextMessages)
      return
    }

    if (Array.isArray(readMessageIds)) {
      const nextMessages = applyReadReceipts(existingMessages, readMessageIds, read)
      saveRoomMessages(normalizedRoomId, nextMessages)
      res.status(200).json(nextMessages)
      return
    }

    const nextMessage = {
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

    if (!nextMessage.text && !nextMessage.attachment) {
      res.status(400).json({ error: 'Message text or attachment is required' })
      return
    }

    const nextMessages = [...existingMessages]
    const existingIndex = nextMessages.findIndex((existingMessage) => {
      if (!clientId) {
        return false
      }

      return Boolean(existingMessage?.clientId) && existingMessage.clientId === clientId
    })

    if (existingIndex >= 0) {
      nextMessages[existingIndex] = nextMessage
    } else {
      nextMessages.push(nextMessage)
    }

    saveRoomMessages(normalizedRoomId, nextMessages)
    res.status(200).json(nextMessages)
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
