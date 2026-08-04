import express from 'express'
import path from 'path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())

const callsStore = new Map()
const messagesStore = new Map()
const presenceStore = new Map()
const eventStreams = new Map()

function normalizeRoomId(roomId) {
  return String(roomId || 'default').trim().toLowerCase().replace(/\s+/g, '-') || 'default'
}

function getRoomMessages(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId)
  return messagesStore.get(normalizedRoomId) || []
}

function saveRoomMessages(roomId, messages) {
  const normalizedRoomId = normalizeRoomId(roomId)
  messagesStore.set(normalizedRoomId, messages)
  return messages
}

function getRoomPresence(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId)
  return presenceStore.get(normalizedRoomId) || {}
}

function getRoomEventStreams(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId)
  const currentStreams = eventStreams.get(normalizedRoomId)
  if (currentStreams) {
    return currentStreams
  }

  const nextStreams = new Set()
  eventStreams.set(normalizedRoomId, nextStreams)
  return nextStreams
}

function emitRoomEvent(roomId, payload) {
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

function upsertRoomPresence(roomId, senderId, nextPresence = {}) {
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

function buildIdentitySet(messageIds = []) {
  return new Set((Array.isArray(messageIds) ? messageIds : []).flatMap((messageId) => {
    if (typeof messageId === 'string') {
      return [messageId]
    }

    return [messageId?.id, messageId?.clientId, messageId?.localId, messageId?.tempId].filter(Boolean)
  }))
}

function messageMatchesIdentity(message = {}, candidate = []) {
  if (!Array.isArray(candidate) || !candidate.length) {
    return false
  }

  const identityCandidates = buildIdentitySet(candidate)
  return identityCandidates.has(message?.id)
    || identityCandidates.has(message?.clientId)
    || identityCandidates.has(message?.localId)
    || identityCandidates.has(message?.tempId)
}

function applyDeliveredReceipts(messages = [], messageIds = [], delivered = true) {
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

function applyReadReceipts(messages = [], messageIds = [], read = true) {
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

app.post('/api/calls', (req, res) => {
  try {
    const { roomId, signal } = req.body
    if (!roomId || !signal) return res.status(400).json({ error: 'roomId and signal required' })
    const list = callsStore.get(roomId) || []
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    const entry = { ...signal, id }
    list.push(entry)
    callsStore.set(roomId, list)
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'server error' })
  }
})

app.get('/api/calls', (req, res) => {
  try {
    const room = String(req.query.room || '')
    const list = callsStore.get(room) || []
    return res.json(list)
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'server error' })
  }
})

app.get('/api/messages', (req, res) => {
  try {
    const roomId = req.query.room || 'default'
    const wantsPresence = String(req.query.presence || '').toLowerCase() === '1' || String(req.query.presence || '').toLowerCase() === 'true'

    if (wantsPresence) {
      res.status(200).json(getRoomPresence(roomId))
      return
    }

    res.status(200).json(getRoomMessages(roomId))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'server error' })
  }
})

app.get('/api/events', (req, res) => {
  const roomId = req.query.room || 'default'
  const normalizedRoomId = normalizeRoomId(roomId)
  const roomStreams = getRoomEventStreams(normalizedRoomId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  roomStreams.add(res)
  res.write(`event: ready\ndata: ${JSON.stringify({ roomId: normalizedRoomId, type: 'ready' })}\n\n`)

  req.on('close', () => {
    roomStreams.delete(res)
    if (!roomStreams.size) {
      eventStreams.delete(normalizedRoomId)
    }
  })
})

app.post('/api/messages', (req, res) => {
  try {
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
      emitRoomEvent(normalizedRoomId, {
        type: 'presence',
        roomId: normalizedRoomId,
        senderId,
        online,
        lastActive: Number(lastActive || Date.now()),
      })
      res.status(200).json(nextPresence)
      return
    }

    if (Array.isArray(deleteMessageIds)) {
      const nextMessages = existingMessages.filter((existingMessage) => !messageMatchesIdentity(existingMessage, deleteMessageIds))
      saveRoomMessages(normalizedRoomId, nextMessages)
      emitRoomEvent(normalizedRoomId, { type: 'message-sync', roomId: normalizedRoomId, messages: nextMessages })
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
      emitRoomEvent(normalizedRoomId, { type: 'message-sync', roomId: normalizedRoomId, messages: nextMessages })
      res.status(200).json(nextMessages)
      return
    }

    if (Array.isArray(deliveredMessageIds)) {
      const nextMessages = applyDeliveredReceipts(existingMessages, deliveredMessageIds, delivered)
      saveRoomMessages(normalizedRoomId, nextMessages)
      emitRoomEvent(normalizedRoomId, { type: 'delivered-receipt', roomId: normalizedRoomId, senderId, messageIds: deliveredMessageIds })
      res.status(200).json(nextMessages)
      return
    }

    if (Array.isArray(readMessageIds)) {
      const nextMessages = applyReadReceipts(existingMessages, readMessageIds, read)
      saveRoomMessages(normalizedRoomId, nextMessages)
      emitRoomEvent(normalizedRoomId, { type: 'read-receipt', roomId: normalizedRoomId, senderId, messageIds: readMessageIds })
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
    emitRoomEvent(normalizedRoomId, { type: 'message-sync', roomId: normalizedRoomId, messages: nextMessages })
    res.status(200).json(nextMessages)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'server error' })
  }
})

// serve static build
app.use(express.static(path.join(__dirname, 'dist')))
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log('Local server listening on', port))
