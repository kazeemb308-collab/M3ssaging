import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())

const callsStore = new Map()
const messagesStore = new Map()

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

app.post('/api/messages', (req, res) => {
  try {
    const { roomId, message, senderId, senderName } = req.body
    if (!roomId || !message) return res.status(400).json({ error: 'roomId and message required' })
    const list = messagesStore.get(roomId) || []
    const entry = { id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), senderId, senderName, text: message }
    list.push(entry)
    messagesStore.set(roomId, list)
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'server error' })
  }
})

// serve static build
app.use(express.static(path.join(__dirname, 'dist')))
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log('Local server listening on', port))
