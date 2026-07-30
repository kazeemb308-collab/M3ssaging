import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { onSnapshot, addDoc, collection, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { auth, db, firebaseReady } from './firebase'
import { firebaseSignOut } from './AppRouter'
import './App.css'

const demoMessages = [
  { id: 'welcome-1', sender: 'her', text: 'Hey babe, our private chat is ready 💕' },
  { id: 'welcome-2', sender: 'me', text: 'Perfect. I am excited to talk with you tonight.' },
]

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState(demoMessages)
  const [draft, setDraft] = useState('')
  const [callMode, setCallMode] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [callError, setCallError] = useState('')

  const roomId = useMemo(() => 'couple-room', [])

  useEffect(() => {
    if (!auth) {
      setUser({ uid: 'demo-user' })
      setLoading(false)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!db || !firebaseReady) {
      setMessages(demoMessages)
      return
    }

    const messagesRef = collection(db, 'rooms', roomId, 'messages')
    const q = query(messagesRef, orderBy('createdAt', 'asc'))

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
    })

    return () => unsubscribe()
  }, [roomId])

  const sendMessage = async (event) => {
    event.preventDefault()

    if (!draft.trim() || !user) {
      return
    }

    if (!db || !firebaseReady) {
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          sender: user.uid || 'demo-user',
          text: draft.trim(),
        },
      ])
      setDraft('')
      return
    }

    await addDoc(collection(db, 'rooms', roomId, 'messages'), {
      text: draft.trim(),
      sender: user.uid,
      createdAt: serverTimestamp(),
    })

    setDraft('')
  }

  const launchCall = async (mode) => {
    setCallError('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setCallError('Your browser does not support media access yet.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: mode === 'video',
        audio: true,
      })

      setLocalStream(stream)
      setCallMode(mode)
    } catch {
      setCallError('Please allow camera and microphone access to start a call.')
    }
  }

  const endCall = () => {
    localStream?.getTracks().forEach((track) => track.stop())
    setLocalStream(null)
    setCallMode(null)
    setCallError('')
  }

  if (loading) {
    return <div className="loading-screen">Loading your private chat...</div>
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">M3ssaging</div>
        <div className="profile-card">
          <div className="avatar">💕</div>
          <div>
            <h2>You & Babe</h2>
            <p>Sweet, private, secure</p>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>Quick actions</h3>
          <button className="sidebar-btn" onClick={() => launchCall('voice')}>
            🎙️ Voice call
          </button>
          <button className="sidebar-btn" onClick={() => launchCall('video')}>
            📹 Video call
          </button>
          <button
            className="sidebar-btn secondary-logout"
            onClick={() => {
              if (auth) {
                firebaseSignOut(auth)
              }
            }}
          >
            ↪ Sign out
          </button>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Private chat</p>
            <h1>My favorite person</h1>
          </div>
          <div className="header-actions">
            <button className="ghost-btn" onClick={() => launchCall('voice')}>
              🎙️ Voice
            </button>
            <button className="ghost-btn" onClick={() => launchCall('video')}>
              📹 Video
            </button>
          </div>
        </header>

        <section className="message-list" aria-label="conversation messages">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`message-bubble ${message.sender === (user?.uid || 'demo-user') ? 'me' : 'her'}`}
            >
              {message.text}
            </article>
          ))}
        </section>

        {callMode ? (
          <section className="call-banner">
            <div>
              <strong>{callMode === 'video' ? '📹 Video call' : '🎙️ Voice call'}</strong>
              <p>Ready for a cozy talk with your partner</p>
            </div>
            <button className="secondary-btn" onClick={endCall}>
              End call
            </button>
          </section>
        ) : null}

        {callMode ? (
          <section className="call-preview">
            <div className="preview-card">
              <h3>Local preview</h3>
              {localStream ? (
                <video autoPlay muted playsInline ref={(videoElement) => {
                  if (videoElement) {
                    videoElement.srcObject = localStream
                  }
                }} />
              ) : (
                <div className="preview-placeholder">Media is connecting...</div>
              )}
            </div>
            <div className="preview-card">
              <h3>Partner status</h3>
              <p>Connected through your shared room. Open this app on another device to join.</p>
            </div>
          </section>
        ) : null}

        {callError ? <p className="call-error">{callError}</p> : null}

        <form className="composer" onSubmit={sendMessage}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a sweet message..."
            aria-label="message input"
          />
          <button type="submit">Send</button>
        </form>
      </main>
    </div>
  )
}

export default App
