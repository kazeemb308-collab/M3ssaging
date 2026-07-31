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
  const [pendingIncomingCall, setPendingIncomingCall] = useState(null)
  const [isMuted, setIsMuted] = useState(false)

  const peerConnectionRef = useRef(null)
  const localStreamRef = useRef(null)
  const channelRef = useRef(null)
  const callRoleRef = useRef('idle')
  const callSessionIdRef = useRef(null)
  const seenSignalIdsRef = useRef(new Set())
  const pollingRef = useRef(null)
  const messageListRef = useRef(null)

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

  const serializeCandidate = (candidate) => {
    if (!candidate) {
      return null
    }

    return {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    }
  }

  const stopCallPolling = () => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const sendCallSignal = async (signal) => {
    if (!normalizedRoomId || !signal) {
      return
    }

    try {
      await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          signal: {
            ...signal,
            callId: callSessionIdRef.current,
            sender: profile.name,
          },
        }),
      })
    } catch (error) {
      console.error(error)
    }
  }

  const processCallSignals = async () => {
    try {
      const response = await fetch(`/api/calls?room=${encodeURIComponent(normalizedRoomId)}`)
      if (!response.ok) {
        return
      }

      const signals = await response.json()
      for (const signal of Array.isArray(signals) ? signals : []) {
        const signalKey = `${signal?.id || 'unknown'}:${signal?.type || 'signal'}`
        if (!signal || seenSignalIdsRef.current.has(signalKey)) {
          continue
        }

        seenSignalIdsRef.current.add(signalKey)

        if (signal.sender === profile.name) {
          continue
        }

        if (signal.type === 'offer' && callRoleRef.current !== 'caller' && !pendingIncomingCall) {
          callSessionIdRef.current = signal.callId
          setPendingIncomingCall({ callerName: signal.sender || 'Someone', offer: signal.offer, callId: signal.callId })
          setCallMode('voice')
          setCallStatus('Incoming call…')
          callRoleRef.current = 'callee'
          continue
        }

        if (!signal.callId || signal.callId !== callSessionIdRef.current) {
          continue
        }

        if (signal.type === 'end') {
          await endCall()
          return
        }

        if (signal.sender === profile.name) {
          continue
        }

        if (signal.type === 'offer' && callRoleRef.current !== 'caller' && !pendingIncomingCall) {
          callSessionIdRef.current = signal.callId
          setPendingIncomingCall({ callerName: signal.sender || 'Someone', offer: signal.offer, callId: signal.callId })
          setCallMode('voice')
          setCallStatus('Incoming call…')
          callRoleRef.current = 'callee'
          continue
        }

        if (signal.type === 'answer' && callRoleRef.current === 'caller' && peerConnectionRef.current) {
          const answer = new window.RTCSessionDescription(signal.answer)
          await peerConnectionRef.current.setRemoteDescription(answer)
          setCallStatus('Connected')
          continue
        }

        if (signal.type === 'candidate' && peerConnectionRef.current) {
          const candidate = new window.RTCIceCandidate(signal.candidate)
          await peerConnectionRef.current.addIceCandidate(candidate)
        }
      }
    } catch (error) {
      console.error(error)
    }
  }

  const startCallPolling = () => {
    stopCallPolling()
    void processCallSignals()
    pollingRef.current = window.setInterval(() => {
      void processCallSignals()
    }, 1000)
  }

  useEffect(() => {
    if (!profile.name) {
      return
    }

    startCallPolling()
    return () => stopCallPolling()
  }, [profile.name, normalizedRoomId])

  const createPeerConnection = async (stream) => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current
    }

    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    }

    const peerConnection = new window.RTCPeerConnection(configuration)
    peerConnectionRef.current = peerConnection

    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream)
    })

    peerConnection.onicecandidate = async (event) => {
      if (!event.candidate) {
        return
      }

      await sendCallSignal({ type: 'candidate', candidate: serializeCandidate(event.candidate) })
    }

    peerConnection.ontrack = (event) => {
      const [remoteMediaStream] = event.streams
      if (remoteMediaStream) {
        setRemoteStream(remoteMediaStream)
        setCallStatus('Connected')
      }
    }

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'connected') {
        setCallStatus('Connected')
      }
      if (['failed', 'disconnected', 'closed'].includes(peerConnection.connectionState)) {
        setCallStatus('Connection interrupted')
      }
    }

    return peerConnection
  }

  const endCall = async () => {
    stopCallPolling()
    stopTracks()
    closePeerConnection()
    callRoleRef.current = 'idle'
    seenSignalIdsRef.current.clear()

    if (callSessionIdRef.current) {
      await sendCallSignal({ type: 'end' })
    }

    callSessionIdRef.current = null
    setCallMode(null)
    setPendingIncomingCall(null)
    setRemoteStream(null)
    setCallStatus('Call ended')
    setCallError('')
    setIsMuted(false)
  }

  const toggleMute = () => {
    const nextMuted = !isMuted
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted
    })
    setIsMuted(nextMuted)
  }

  const ensureLocalStream = async () => {
    if (localStreamRef.current) {
      return localStreamRef.current
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    })

    localStreamRef.current = stream
    setLocalStream(stream)
    return stream
  }

  const acceptIncomingCall = async () => {
    if (!pendingIncomingCall) {
      return
    }

    setPendingIncomingCall(null)
    setCallStatus('Connecting…')
    setCallError('')
    callRoleRef.current = 'callee'
    if (pendingIncomingCall.callId) {
      callSessionIdRef.current = pendingIncomingCall.callId
    }

    try {
      const stream = await ensureLocalStream()
      const peerConnection = await createPeerConnection(stream)
      await peerConnection.setRemoteDescription(new window.RTCSessionDescription(pendingIncomingCall.offer))

      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)
      await sendCallSignal({ type: 'answer', answer: { type: answer.type, sdp: answer.sdp } })
      startCallPolling()
    } catch (error) {
      console.error(error)
      setCallError('Unable to accept the call. Please try again.')
      await endCall()
    }
  }

  const declineIncomingCall = async () => {
    setPendingIncomingCall(null)
    setCallStatus('Call declined')
    setCallMode(null)
    setCallError('')
    await sendCallSignal({ type: 'end' })
  }

  const startCall = async () => {
    if (!profile.partnerName) {
      setCallError('Add your partner name first.')
      return
    }

    setCallError('')
    setPendingIncomingCall(null)
    setCallMode('voice')
    setCallStatus('Calling…')
    callRoleRef.current = 'caller'
    callSessionIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    seenSignalIdsRef.current.clear()

    try {
      const stream = await ensureLocalStream()
      const peerConnection = await createPeerConnection(stream)
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      await sendCallSignal({ type: 'offer', offer: { type: offer.type, sdp: offer.sdp } })
      startCallPolling()
    } catch (error) {
      console.error(error)
      setCallError('Call setup failed. Please allow microphone access.')
      await endCall()
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
        const savedMessages = window.localStorage.getItem(`m3ssaging-messages:${normalizedRoomId}`)
        const existingMessages = savedMessages ? JSON.parse(savedMessages) : []
        if (remoteMessages.length >= (Array.isArray(existingMessages) ? existingMessages.length : 0)) {
          setMessages(remoteMessages)
          window.localStorage.setItem(`m3ssaging-messages:${normalizedRoomId}`, JSON.stringify(remoteMessages))
        }
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
    }

    return () => {
      window.clearInterval(intervalId)
      channel.close()
    }
  }, [profile.name, normalizedRoomId])

  useEffect(() => {
    if (!messageListRef.current) {
      return
    }

    messageListRef.current.scrollTop = messageListRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    return () => {
      stopCallPolling()
      stopTracks()
      closePeerConnection()
      channelRef.current?.close()
      channelRef.current = null
    }
  }, [profile.name, normalizedRoomId])

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
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          message: trimmedMessage,
          senderId: profile.name,
          senderName: profile.name,
        }),
      })

      if (response.ok) {
        const remoteMessages = await response.json()
        saveMessages(remoteMessages, normalizedRoomId)
      }
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
          <button className="sidebar-btn" onClick={() => startCall()}>
            🎙️ Start voice call
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
        <div className="chat-top-nav">
          <div className="top-nav-row">
            <div className="top-nav-tabs">
              <button className="nav-tab active">Chats</button>
              <button className="nav-tab">Calls</button>
            </div>
            <div className="top-nav-identity">
              <span>{profile.partnerName || 'Private room'}</span>
              <button className="ghost-btn" onClick={() => startCall()}>
                🎙️ Voice
              </button>
            </div>
          </div>
          <div className="nav-divider" />
          <div className="nav-divider subtle" />
        </div>

        {callMode ? (
          <div className="call-overlay">
            <div className="call-overlay-shell">
              <div className="call-header">
                <div>
                  <p className="eyebrow">Voice call</p>
                  <h2>{pendingIncomingCall ? 'Incoming voice call' : profile.partnerName || 'Private call'}</h2>
                  <p>{callStatus}</p>
                </div>
                <button className="secondary-btn" onClick={endCall}>End</button>
              </div>

              <div className="call-hero">
                <div className="call-avatar-large">{(profile.partnerName || profile.name || 'M')[0].toUpperCase()}</div>
                <h3>{profile.partnerName || profile.name || 'Partner'}</h3>
                <p>{pendingIncomingCall ? 'Tap to answer' : 'Voice call in progress'}</p>
              </div>

              <div className="call-status-card">
                <p>{localStream ? 'Microphone connected' : 'Connecting microphone...'}</p>
                <p>{remoteStream ? 'Connected to your partner' : 'Waiting for your partner...'}</p>
                <audio autoPlay muted playsInline ref={(audioElement) => {
                  if (audioElement && localStream && audioElement.srcObject !== localStream) {
                    audioElement.srcObject = localStream
                  }
                }} />
                <audio autoPlay playsInline ref={(audioElement) => {
                  if (audioElement && remoteStream && audioElement.srcObject !== remoteStream) {
                    audioElement.srcObject = remoteStream
                  }
                }} />
              </div>

              <div className="call-controls">
                <button className="control-btn" onClick={toggleMute}>{isMuted ? '🔇 Unmute' : '🔈 Mute'}</button>
                <button className="control-btn danger" onClick={endCall}>📵 End</button>
              </div>

              {pendingIncomingCall ? (
                <div className="incoming-actions">
                  <button className="accept-btn" onClick={acceptIncomingCall}>Accept</button>
                  <button className="decline-btn" onClick={declineIncomingCall}>Decline</button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {callError ? <p className="call-error">{callError}</p> : null}

        <section className="message-list" aria-label="conversation messages" ref={messageListRef}>
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
