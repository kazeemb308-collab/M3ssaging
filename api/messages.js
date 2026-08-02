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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const roomId = req.query.room || 'default'
    res.status(200).json(getRoomMessages(roomId))
    return
  }

  if (req.method === 'POST') {
    const { roomId, message, clientId, senderId, senderName, messageType, attachment, timestamp } = req.body || {}
    const normalizedRoomId = normalizeRoomId(roomId)
    const existingMessages = getRoomMessages(normalizedRoomId)
    const nextMessage = {
      id: createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex'),
      clientId: clientId || null,
      senderId: senderId || 'unknown',
      senderName: senderName || 'Unknown',
      text: String(message || '').trim(),
      messageType: String(messageType || 'text'),
      attachment: attachment || null,
      timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
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
