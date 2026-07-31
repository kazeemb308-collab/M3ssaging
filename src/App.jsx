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
  const [recording, setRecording] = useState(false)
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null)
  const [recordedAudioBlob, setRecordedAudioBlob] = useState(null)
  const [attachment, setAttachment] = useState(null)
  const [messageError, setMessageError] = useState('')
  const [channelReady, setChannelReady] = useState(false)

  const mediaRecorderRef = useRef(null)
  const channelRef = useRef(null)

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

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    setRecording(false)
  }

  const clearRecordedAudio = () => {
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl)
    }
    setRecordedAudioUrl(null)
    setRecordedAudioBlob(null)
  }

  const startRecording = async () => {
    setMessageError('')
    clearAttachment()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const recorder = new MediaRecorder(stream)
      const chunks = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setRecordedAudioUrl(url)
        setRecordedAudioBlob(blob)
        stream.getTracks().forEach((track) => track.stop())
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch (error) {
      console.error(error)
      setMessageError('Unable to access microphone. Please allow access.')
    }
  }

  const handleAttachment = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      setAttachment(null)
      return
    }

    setMessageError('')
    clearRecordedAudio()

    if (file.size > 15 * 1024 * 1024) {
      setMessageError('File size must be less than 15MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setAttachment({
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result,
      })
    }
    reader.readAsDataURL(file)
  }

  const clearAttachment = () => {
    setAttachment(null)
    const input = document.querySelector('#attachment-input')
    if (input) input.value = ''
  }

  const sendAttachmentMessage = async () => {
    if (!attachment) {
      return
    }

    const nextMessage = {
      id: `local-${Date.now()}`,
      senderId: profile.name,
      senderName: profile.name,
      text: attachment.name,
      attachment: { ...attachment },
      messageType: 'attachment',
    }

    const nextMessages = [...messages, nextMessage]
    saveMessages(nextMessages, normalizedRoomId)
    clearAttachment()

    if (db && firebaseReady) {
      await addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
        text: attachment.name,
        senderId: profile.name,
        senderName: profile.name,
        createdAt: serverTimestamp(),
        messageType: 'attachment',
        attachment,
      })
      return
    }

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          message: attachment.name,
          senderId: profile.name,
          senderName: profile.name,
          messageType: 'attachment',
          attachment,
        }),
      })
    } catch {
      // Remote sync will retry on the next poll if the API is temporarily unavailable.
    }
  }

  const sendVoiceMessage = async () => {
    if (!recordedAudioBlob) {
      return
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(recordedAudioBlob)
    })

    const voiceAttachment = {
      name: `voice-message-${Date.now()}.webm`,
      type: recordedAudioBlob.type || 'audio/webm',
      size: recordedAudioBlob.size,
      data: dataUrl,
    }

    const nextMessage = {
      id: `local-${Date.now()}`,
      senderId: profile.name,
      senderName: profile.name,
      text: 'Voice message',
      attachment: voiceAttachment,
      messageType: 'voice',
    }

    const nextMessages = [...messages, nextMessage]
    saveMessages(nextMessages, normalizedRoomId)
    clearRecordedAudio()

    if (db && firebaseReady) {
      await addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
        text: 'Voice message',
        senderId: profile.name,
        senderName: profile.name,
        createdAt: serverTimestamp(),
        messageType: 'voice',
        attachment: voiceAttachment,
      })
      return
    }

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          message: 'Voice message',
          senderId: profile.name,
          senderName: profile.name,
          messageType: 'voice',
          attachment: voiceAttachment,
        }),
      })
    } catch {
      // Remote sync will retry on the next poll if the API is temporarily unavailable.
    }
  }

  const sendMessage = async (event) => {
    event.preventDefault()

    if (recordedAudioBlob) {
      await sendVoiceMessage()
      setDraft('')
      return
    }

    if (attachment) {
      await sendAttachmentMessage()
      setDraft('')
      return
    }

    if (!draft.trim() || !profile.name) {
      return
    }

    const trimmedMessage = draft.trim()
    const nextMessage = {
      id: `local-${Date.now()}`,
      senderId: profile.name,
      senderName: profile.name,
      text: trimmedMessage,
      messageType: 'text',
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
        messageType: 'text',
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
          messageType: 'text',
        }),
      })
    } catch {
      // Remote sync will retry on the next poll if the API is temporarily unavailable.
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
          attachment: doc.data().attachment || null,
          messageType: doc.data().messageType || 'text',
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
    }

    return () => {
      window.clearInterval(intervalId)
      channel.close()
    }
  }, [profile.name, normalizedRoomId])

  useEffect(() => {
    return () => {
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
        text: `Welcome ${name}! Use room ${roomId} on both devices to chat in real time.`,
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
    setRecordedAudioUrl(null)
    setAttachment(null)
    setMessageError('')

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('m3ssaging-profile')
    }
  }

  if (!isSignedUp) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand">M3ssaging</div>
          <h1>Create your chat space</h1>
          <p className="auth-copy">Set your name, add your partner, and use the same room name on both phones to send voice messages, photos, and documents.</p>

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
          <button className="sidebar-btn" onClick={() => { window.document.querySelector('#attachment-input')?.click() }}>
            📎 Attach file
          </button>
          <button className="sidebar-btn" onClick={() => { recording ? stopRecording() : startRecording() }}>
            {recording ? '⏹️ Stop recording' : '🎙️ Record voice'}
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
            <div className="top-nav-identity">
              <span>{profile.partnerName || 'Private room'}</span>
            </div>
          </div>
          <div className="nav-divider" />
        </div>

        <section className="message-list" aria-label="conversation messages">
          {messages.map((message) => {
            const isMine = message.senderId === profile.name
            const isSystem = message.senderId === 'system'
            const isVoice = message.messageType === 'voice' && message.attachment
            const isAttachment = message.messageType === 'attachment' && message.attachment
            return (
              <article key={message.id} className={`message-bubble ${isSystem ? 'system' : isMine ? 'me' : 'her'}`}>
                {!isSystem ? <div className="message-meta">{message.senderName}</div> : null}
                <div className="message-text">{message.text}</div>
                {isVoice ? (
                  <div className="message-attachment">
                    <audio controls src={message.attachment.data} />
                    <div className="attachment-label">Voice message</div>
                  </div>
                ) : null}
                {isAttachment && !isVoice ? (
                  <div className="message-attachment">
                    {message.attachment.type?.startsWith('image/') ? (
                      <img src={message.attachment.data} alt={message.attachment.name} />
                    ) : (
                      <a href={message.attachment.data} download={message.attachment.name} className="attachment-link">
                        {message.attachment.name}
                      </a>
                    )}
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>

        <input
          id="attachment-input"
          type="file"
          accept="image/*,video/*,application/pdf,audio/*"
          hidden
          onChange={handleAttachment}
        />

        {messageError ? <div className="composer-error">{messageError}</div> : null}

        {(attachment || recordedAudioUrl) ? (
          <div className="composer-preview">
            {attachment ? (
              <div className="attachment-card">
                <span>Attachment:</span>
                <strong>{attachment.name}</strong>
                <button type="button" className="clear-btn" onClick={clearAttachment}>Remove</button>
              </div>
            ) : null}
            {recordedAudioUrl ? (
              <div className="attachment-card">
                <span>Recording ready</span>
                <audio controls src={recordedAudioUrl} />
                <button type="button" className="clear-btn" onClick={clearRecordedAudio}>Remove</button>
              </div>
            ) : null}
          </div>
        ) : null}

        <form className="composer" onSubmit={sendMessage}>
          <button type="button" className="composer-action" onClick={() => document.querySelector('#attachment-input')?.click()}>📎</button>
          <button type="button" className="composer-action" onClick={() => { recording ? stopRecording() : startRecording() }}>
            {recording ? '⏹️' : '🎙️'}
          </button>
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
