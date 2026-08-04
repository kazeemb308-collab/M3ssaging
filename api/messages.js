import { createHash } from 'node:crypto'

const store = new Map()

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

function messageMatchesIdentity(message = {}, candidate = []) {
  if (!Array.isArray(candidate) || !candidate.length) {
    return false
  }

  const identityCandidates = candidate.flatMap((entry) => [
    entry?.id,
    entry?.clientId,
    entry?.localId,
    entry?.tempId,
    typeof entry === 'string' ? entry : null,
  ]).filter(Boolean)

  return identityCandidates.includes(message?.id)
    || identityCandidates.includes(message?.clientId)
    || identityCandidates.includes(message?.localId)
    || identityCandidates.includes(message?.tempId)
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
    } = req.body || {}
    const normalizedRoomId = normalizeRoomId(roomId)
    const existingMessages = getRoomMessages(normalizedRoomId)

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
          text: String(updateMessage.text || existingMessage.text || '').trim(),
          edited: Boolean(updateMessage.edited),
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
