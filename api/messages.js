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
    const { roomId, message, senderId, senderName } = req.body || {}
    const normalizedRoomId = normalizeRoomId(roomId)
    const existingMessages = getRoomMessages(normalizedRoomId)
    const nextMessage = {
      id: createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex'),
      senderId: senderId || 'unknown',
      senderName: senderName || 'Unknown',
      text: String(message || '').trim(),
    }

    if (!nextMessage.text) {
      res.status(400).json({ error: 'Message text is required' })
      return
    }

    const nextMessages = [...existingMessages, nextMessage]
    saveRoomMessages(normalizedRoomId, nextMessages)
    res.status(200).json(nextMessages)
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
