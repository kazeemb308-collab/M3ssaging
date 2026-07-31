import http from 'http'
import fs from 'fs'
import path from 'path'

const distDir = path.join(process.cwd(), 'dist')
const callsStore = new Map()
const messagesStore = new Map()

const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]

  if (url === '/api/calls' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => body += chunk)
    req.on('end', () => {
      try {
        const { roomId, signal } = JSON.parse(body)
        if (!roomId || !signal) return sendJson(res, 400, { error: 'roomId and signal required' })
        const list = callsStore.get(roomId) || []
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
        const entry = { ...signal, id }
        list.push(entry)
        callsStore.set(roomId, list)
        sendJson(res, 200, { ok: true })
      } catch (e) {
        console.error(e)
        sendJson(res, 500, { error: 'server error' })
      }
    })
    return
  }

  if (url === '/api/calls' && req.method === 'GET') {
    const q = new URL(req.url, `http://${req.headers.host}`)
    const room = String(q.searchParams.get('room') || '')
    const list = callsStore.get(room) || []
    return sendJson(res, 200, list)
  }

  if (url === '/api/messages' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => body += chunk)
    req.on('end', () => {
      try {
        const { roomId, message, senderId, senderName } = JSON.parse(body)
        if (!roomId || !message) return sendJson(res, 400, { error: 'roomId and message required' })
        const list = messagesStore.get(roomId) || []
        const entry = { id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), senderId, senderName, text: message }
        list.push(entry)
        messagesStore.set(roomId, list)
        sendJson(res, 200, { ok: true })
      } catch (e) {
        console.error(e)
        sendJson(res, 500, { error: 'server error' })
      }
    })
    return
  }

  // serve static files from dist
  let filePath = path.join(distDir, url === '/' ? '/index.html' : url)
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      fs.createReadStream(path.join(distDir, 'index.html')).pipe(res)
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const contentType = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
      '.otf': 'font/otf',
      '.webp': 'image/webp',
    }[ext] || 'application/octet-stream'

    res.writeHead(200, { 'Content-Type': contentType })
    const stream = fs.createReadStream(filePath)
    stream.on('error', () => res.writeHead(500).end('Server error'))
    stream.pipe(res)
  })
})

const port = process.env.PORT || 3001
server.listen(port, () => console.log('Simple server listening on', port))
