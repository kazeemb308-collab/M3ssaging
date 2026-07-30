import { createHash } from 'node:crypto'

const store = new Map()

function normalizeRoomId(roomId) {
  return String(roomId || 'default').trim().toLowerCase().replace(/\s+/g, '-') || 'default'
}

function getRoomSignals(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId)
  return store.get(normalizedRoomId) || []
}

function saveRoomSignals(roomId, signals) {
  const normalizedRoomId = normalizeRoomId(roomId)
  store.set(normalizedRoomId, signals)
  return signals
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const roomId = req.query.room || 'default'
    res.status(200).json(getRoomSignals(roomId))
    return
  }

  if (req.method === 'POST') {
    const { roomId, signal } = req.body || {}
    const normalizedRoomId = normalizeRoomId(roomId)
    const existingSignals = getRoomSignals(normalizedRoomId)
    const nextSignal = {
      ...signal,
      id: signal?.id || createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex'),
    }

    if (!nextSignal || !nextSignal.type) {
      res.status(400).json({ error: 'Signal payload is required' })
      return
    }

    const nextSignals = [...existingSignals, nextSignal]
    saveRoomSignals(normalizedRoomId, nextSignals)
    res.status(200).json(nextSignals)
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
