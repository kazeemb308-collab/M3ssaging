import { useEffect, useRef, useState } from 'react'
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { db, firebaseReady } from './firebase'
import './App.css'

const demoMessages = [
  {
    id: 'welcome',
    senderId: 'system',
    senderName: 'M3ssaging',
    text: 'Welcome to your private couple chat. Sign up and start chatting.',
  },
]

const defaultProfile = {
  name: '',
  partnerName: '',
  roomId: 'couple-room',
}

const pcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

const getMessagesApiUrl = (roomId) => `/api/messages?room=${encodeURIComponent(roomId)}`

async function syncMessagesFromApi(roomId) {
  try {
    const response = await fetch(getMessagesApiUrl(roomId))
    if (!response.ok) {
      throw new Error('Unable to sync messages')
    }

    const nextMessages = await response.json()
    return Array.isArray(nextMessages) ? nextMessages : []
  } catch {
    return []
  }
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
  const [formValues, setFormValues] = useState({
    name: profile.name,
    partnerName: profile.partnerName,
    roomId: profile.roomId,
  })
  const [callMode, setCallMode] = useState(null)
  const [callStatus, setCallStatus] = useState('Ready to connect')
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [callError, setCallError] = useState('')
  const [channelReady, setChannelReady] = useState(false)

  const peerConnectionRef = useRef(null)
  const localStreamRef = useRef(null)
  const channelRef = useRef(null)
  const processedSignalsRef = useRef(new Set())

  const normalizedRoomId = (profile.roomId || 'couple-room').trim().toLowerCase().replace(/\s+/g, '-') || 'couple-room'

  const saveMessages = (nextMessages, roomId) => {
    setMessages(nextMessages)

    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(`m3ssaging-messages:${roomId}`, JSON.stringify(nextMessages))

    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'message-sync', roomId, messages: nextMessages })
    }
  }

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

  const stopTracks = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    setLocalStream(null)
  }

  const closePeerConnection = () => {
    peerConnectionRef.current?.close()
    peerConnectionRef.current = null
  }

  const endCall = () => {
    stopTracks()
    closePeerConnection()
    setCallMode(null)
    setRemoteStream(null)
    setCallStatus('Call ended')
    setCallError('')
  }

  const ensureLocalStream = async (mode) => {
    if (localStreamRef.current) {
      return localStreamRef.current
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === 'video',
    })

    localStreamRef.current = stream
    setLocalStream(stream)
    return stream
  }

  const createPeerConnection = async (mode) => {
    const stream = await ensureLocalStream(mode)

    if (peerConnectionRef.current) {
      return peerConnectionRef.current
    }

    const pc = new RTCPeerConnection(pcConfig)

    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    pc.ontrack = (event) => {
      const [remoteStreamTrack] = event.streams
      if (remoteStreamTrack) {
        setRemoteStream(remoteStreamTrack)
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal({ type: 'candidate', candidate: event.candidate })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setCallStatus('Connected')
      } else if (pc.connectionState === 'connecting') {
        setCallStatus('Connecting…')
      }
    }

    peerConnectionRef.current = pc
    return pc
  }

  const sendSignal = async (signal) => {
    if (!profile.name) {
      return
    }

    const payload = {
      ...signal,
      senderId: profile.name,
      senderName: profile.name,
      roomId: normalizedRoomId,
      createdAt: serverTimestamp(),
    }

    if (db && firebaseReady) {
      await addDoc(collection(db, 'rooms', normalizedRoomId, 'signals'), payload)
      return
    }

    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'signal', roomId: normalizedRoomId, signal: payload })
    }
  }

  const handleIncomingSignal = async (signal) => {
    if (!signal || signal.senderId === profile.name) {
      return
    }

    if (!peerConnectionRef.current) {
      await createPeerConnection(signal.mode || 'voice')
    }

    const pc = peerConnectionRef.current
    if (!pc) {
      return
    }

    if (signal.type === 'offer') {
      setCallMode(signal.mode || 'voice')
      setCallStatus('Incoming call…')
      await pc.setRemoteDescription(new RTCSessionDescription(signal.offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await sendSignal({ type: 'answer', answer })
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.answer))
    } else if (signal.type === 'candidate') {
      if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
      }
    }
  }

  const startCall = async (mode) => {
    setCallError('')
    setCallMode(mode)
    setCallStatus('Connecting…')

    try {
      const pc = await createPeerConnection(mode)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await sendSignal({ type: 'offer', mode, offer })
    } catch (error) {
      console.error(error)
      setCallError('Call setup failed. Please allow microphone and camera access.')
      endCall()
    }
  }

  useEffect(() => {
    if (!profile.name) {
      setMessages(demoMessages)
      return
    }

    if (db && firebaseReady) {
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
    }

    const loadMessages = async () => {
      const savedMessages = window.localStorage.getItem(`m3ssaging-messages:${normalizedRoomId}`)
      if (savedMessages) {
        try {
          const parsedMessages = JSON.parse(savedMessages)
          if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
            setMessages(parsedMessages)
          }
        } catch {
          setMessages(demoMessages)
        }
      }

      const remoteMessages = await syncMessagesFromApi(normalizedRoomId)
      if (remoteMessages.length > 0) {
        setMessages(remoteMessages)
        window.localStorage.setItem(`m3ssaging-messages:${normalizedRoomId}`, JSON.stringify(remoteMessages))
      }
    }

    void loadMessages()
    setChannelReady(true)

    const intervalId = window.setInterval(() => {
      void loadMessages()
    }, 2000)

    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
      return () => window.clearInterval(intervalId)
    }

    const channel = new window.BroadcastChannel(`m3ssaging-${normalizedRoomId}`)
    channelRef.current = channel

    channel.onmessage = (event) => {
      if (event.data.type === 'message-sync' && event.data.roomId === normalizedRoomId) {
        setMessages(event.data.messages)
      }

      if (event.data.type === 'signal' && event.data.roomId === normalizedRoomId) {
        void handleIncomingSignal(event.data.signal)
      }
    }

    return () => {
      window.clearInterval(intervalId)
      channel.close()
    }
  }, [profile.name, normalizedRoomId])

  useEffect(() => {
    if (!profile.name || !db || !firebaseReady) {
      return undefined
    }

    processedSignalsRef.current = new Set()
    const signalsRef = collection(db, 'rooms', normalizedRoomId, 'signals')
    const q = query(signalsRef, orderBy('createdAt', 'asc'))

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') {
          return
        }

        const signal = change.doc.data()
        if (signal.senderId === profile.name) {
          return
        }

        if (processedSignalsRef.current.has(change.doc.id)) {
          return
        }

        processedSignalsRef.current.add(change.doc.id)
        void handleIncomingSignal(signal)
      })
    })

    return () => unsubscribe()
  }, [profile.name, normalizedRoomId])

  useEffect(() => {
    return () => {
      stopTracks()
      closePeerConnection()
      channelRef.current?.close()
    }
  }, [])

  const handleSignup = (event) => {
    event.preventDefault()

    const name = formValues.name.trim()
    const partnerName = formValues.partnerName.trim()
    const roomId = (formValues.roomId || 'couple-room').trim().toLowerCase().replace(/\s+/g, '-') || 'couple-room'

    if (!name) {
      return
    }

    const nextProfile = { name, partnerName, roomId }
    saveProfile(nextProfile)
    setIsSignedUp(true)
    setMessages([
      {
        id: 'welcome-joined',
        senderId: 'system',
        senderName: 'M3ssaging',
        text: `Welcome ${name}! Use room ${roomId} on both devices to chat and call in real time.`,
      },
    ])
    setDraft('')
  }

  const handleSignOut = () => {
    setProfile(defaultProfile)
    setFormValues({ name: '', partnerName: '', roomId: 'couple-room' })
    setIsSignedUp(false)
    setMessages(demoMessages)
    setDraft('')
    setCallMode(null)
    endCall()

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('m3ssaging-profile')
    }
  }

  const sendMessage = async (event) => {
    event.preventDefault()

    if (!draft.trim() || !profile.name) {
      return
    }

    const trimmedMessage = draft.trim()
    const nextMessage = {
      id: `local-${Date.now()}`,
      senderId: profile.name,
      senderName: profile.name,
      text: trimmedMessage,
    }

    const nextMessages = [...messages, nextMessage]
    saveMessages(nextMessages, normalizedRoomId)
    setDraft('')

    if (db && firebaseReady) {
      await addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
        text: trimmedMessage,
        senderId: profile.name,
        senderName: profile.name,
        createdAt: serverTimestamp(),
      })
      return
    }

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          message: trimmedMessage,
          senderId: profile.name,
          senderName: profile.name,
        }),
      })
    } catch {
      // Remote sync will retry on the next poll if the API is temporarily unavailable.
    }
  }

  if (!isSignedUp) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand">M3ssaging</div>
          <h1>Create your chat space</h1>
          <p className="auth-copy">Set your name, add your partner, and use the same room name on both phones to send real messages and make real calls.</p>

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

          <p className="helper-text">Use the same room name on both devices for instant syncing.</p>
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
          <button className="sidebar-btn" onClick={() => startCall('voice')}>
            🎙️ Start voice call
          </button>
          <button className="sidebar-btn" onClick={() => startCall('video')}>
            📹 Start video call
          </button>
          <button className="sidebar-btn secondary-logout" onClick={handleSignOut}>
            ↪ Sign out
          </button>
        </div>

        <div className="status-box">
          <div className="status-pill">{firebaseReady ? 'Cloud synced' : 'Local mode'}</div>
          <p>Room: {normalizedRoomId}</p>
          <p>{channelReady ? 'Live sync ready' : 'Preparing sync'}</p>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">WhatsApp-style chat</p>
            <h1>{profile.partnerName ? `Chat with ${profile.partnerName}` : 'Your private room'}</h1>
          </div>
          <div className="header-actions">
            <button className="ghost-btn" onClick={() => startCall('voice')}>
              🎙️ Voice
            </button>
            <button className="ghost-btn" onClick={() => startCall('video')}>
              📹 Video
            </button>
          </div>
        </header>

        {callMode ? (
          <section className="call-card">
            <div>
              <strong>{callMode === 'video' ? '📹 Video call' : '🎙️ Voice call'}</strong>
              <p>{callStatus}</p>
            </div>
            <button className="secondary-btn" onClick={endCall}>
              End call
            </button>
          </section>
        ) : null}

        {callMode ? (
          <section className="call-preview">
            <div className="preview-card">
              <h3>You</h3>
              {localStream ? (
                <video autoPlay muted playsInline ref={(videoElement) => {
                  if (videoElement && videoElement.srcObject !== localStream) {
                    videoElement.srcObject = localStream
                  }
                }} />
              ) : (
                <div className="preview-placeholder">Audio call ready</div>
              )}
            </div>
            <div className="preview-card">
              <h3>Partner</h3>
              {remoteStream ? (
                <video autoPlay playsInline ref={(videoElement) => {
                  if (videoElement && videoElement.srcObject !== remoteStream) {
                    videoElement.srcObject = remoteStream
                  }
                }} />
              ) : (
                <div className="preview-placeholder">Waiting for connection</div>
              )}
            </div>
          </section>
        ) : null}

        {callError ? <p className="call-error">{callError}</p> : null}

        <section className="message-list" aria-label="conversation messages">
          {messages.map((message) => {
            const isMine = message.senderId === profile.name
            const isSystem = message.senderId === 'system'
            return (
              <article key={message.id} className={`message-bubble ${isSystem ? 'system' : isMine ? 'me' : 'her'}`}>
                {!isSystem ? <div className="message-meta">{message.senderName}</div> : null}
                <div>{message.text}</div>
              </article>
            )
          })}
        </section>

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
