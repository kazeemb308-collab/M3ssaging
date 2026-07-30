import { useEffect, useState } from 'react'
import { onSnapshot, addDoc, collection, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { db, firebaseReady } from './firebase'
import './App.css'

const demoMessages = [
  { id: 'welcome-1', senderId: 'system', senderName: 'M3ssaging', text: 'Your chat room is ready. Sign up and send your first message.' },
]

const defaultProfile = {
  name: '',
  partnerName: '',
  roomId: 'couple-room',
}

function getStoredProfile() {
  if (typeof window === 'undefined') {
    return defaultProfile
  }

  const saved = window.localStorage.getItem('m3ssaging-profile')
  if (!saved) {
    return defaultProfile
  }

  try {
    return { ...defaultProfile, ...JSON.parse(saved) }
  } catch {
    return defaultProfile
  }
}

function App() {
  const [profile, setProfile] = useState(getStoredProfile)
  const [isSignedUp, setIsSignedUp] = useState(Boolean(getStoredProfile().name))
  const [messages, setMessages] = useState(demoMessages)
  const [draft, setDraft] = useState('')
  const [callMode, setCallMode] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [callError, setCallError] = useState('')
  const [formValues, setFormValues] = useState({
    name: profile.name,
    partnerName: profile.partnerName,
    roomId: profile.roomId,
  })

  useEffect(() => {
    if (!db || !firebaseReady || !profile.name) {
      setMessages(demoMessages)
      return
    }

    const normalizedRoomId = (profile.roomId || 'couple-room').trim().toLowerCase().replace(/\s+/g, '-') || 'couple-room'
    const messagesRef = collection(db, 'rooms', normalizedRoomId, 'messages')
    const q = query(messagesRef, orderBy('createdAt', 'asc'))

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const nextMessages = snapshot.docs.map((doc) => ({
        id: doc.id,
        senderId: doc.data().senderId || 'unknown',
        senderName: doc.data().senderName || 'Someone',
        text: doc.data().text || '',
      }))
      setMessages(nextMessages)
    })

    return () => unsubscribe()
  }, [profile.name, profile.roomId])

  const saveProfile = (nextProfile) => {
    setProfile(nextProfile)
    setFormValues({
      name: nextProfile.name,
      partnerName: nextProfile.partnerName,
      roomId: nextProfile.roomId,
    })

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('m3ssaging-profile', JSON.stringify(nextProfile))
    }
  }

  const handleSignup = (event) => {
    event.preventDefault()

    const name = formValues.name.trim()
    const partnerName = formValues.partnerName.trim()
    const roomId = (formValues.roomId || 'couple-room').trim().toLowerCase().replace(/\s+/g, '-') || 'couple-room'

    if (!name) {
      return
    }

    const nextProfile = {
      name,
      partnerName,
      roomId,
    }

    saveProfile(nextProfile)
    setIsSignedUp(true)
    setMessages([
      {
        id: 'welcome-joined',
        senderId: 'system',
        senderName: 'M3ssaging',
        text: `Welcome ${name}! Your chat room is ready for ${partnerName || 'your partner'}.`,
      },
    ])
    setDraft('')
  }

  const handleSignOut = () => {
    const clearedProfile = defaultProfile
    setProfile(clearedProfile)
    setFormValues({
      name: '',
      partnerName: '',
      roomId: 'couple-room',
    })
    setIsSignedUp(false)
    setMessages(demoMessages)
    setDraft('')

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('m3ssaging-profile')
    }
  }

  const sendMessage = async (event) => {
    event.preventDefault()

    if (!draft.trim() || !profile.name) {
      return
    }

    const normalizedRoomId = (profile.roomId || 'couple-room').trim().toLowerCase().replace(/\s+/g, '-') || 'couple-room'

    if (!db || !firebaseReady) {
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          senderId: profile.name,
          senderName: profile.name,
          text: draft.trim(),
        },
      ])
      setDraft('')
      return
    }

    await addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
      text: draft.trim(),
      senderId: profile.name,
      senderName: profile.name,
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

  if (!isSignedUp) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand">M3ssaging</div>
          <h1>Create your private chat</h1>
          <p className="auth-copy">Pick a name, add your partner, and start sharing messages from both ends.</p>

          <form className="auth-form" onSubmit={handleSignup}>
            <label className="input-group">
              <span>Your name</span>
              <input
                type="text"
                value={formValues.name}
                onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Enter your name"
              />
            </label>

            <label className="input-group">
              <span>Partner's name</span>
              <input
                type="text"
                value={formValues.partnerName}
                onChange={(event) => setFormValues((prev) => ({ ...prev, partnerName: event.target.value }))}
                placeholder="Add your partner"
              />
            </label>

            <label className="input-group">
              <span>Room name</span>
              <input
                type="text"
                value={formValues.roomId}
                onChange={(event) => setFormValues((prev) => ({ ...prev, roomId: event.target.value }))}
                placeholder="couple-room"
              />
            </label>

            <button className="auth-btn" type="submit">Start chatting</button>
          </form>

          <p className="helper-text">Use the same room name on both devices to receive each other’s messages.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">M3ssaging</div>
        <div className="profile-card">
          <div className="avatar">💕</div>
          <div>
            <h2>{profile.name}</h2>
            <p>{profile.partnerName ? `Chatting with ${profile.partnerName}` : 'Private and secure'}</p>
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
          <button className="sidebar-btn secondary-logout" onClick={handleSignOut}>
            ↪ Sign out
          </button>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Private chat</p>
            <h1>{profile.partnerName ? `Chat with ${profile.partnerName}` : 'Your private room'}</h1>
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
          {messages.map((message) => {
            const isMine = message.senderId === profile.name
            return (
              <article key={message.id} className={`message-bubble ${isMine ? 'me' : message.senderId === 'system' ? 'system' : 'her'}`}>
                <div className="message-meta">{message.senderName}</div>
                <div>{message.text}</div>
              </article>
            )
          })}
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
              <p>Connected through your shared room. Open this app on another device with the same room name.</p>
            </div>
          </section>
        ) : null}

        {callError ? <p className="call-error">{callError}</p> : null}

        <form className="composer" onSubmit={sendMessage}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message..."
            aria-label="message input"
          />
          <button type="submit">Send</button>
        </form>
      </main>
    </div>
  )
}

export default App
