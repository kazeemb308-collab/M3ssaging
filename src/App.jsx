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
  const [voiceMessageStatus, setVoiceMessageStatus] = useState('Ready')
  const [recordingError, setRecordingError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [channelReady, setChannelReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null)
  const [recordedAudioBlob, setRecordedAudioBlob] = useState(null)
  const [recordingDuration, setRecordingDuration] = useState(0)

  const channelRef = useRef(null)
  const messageListRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordingIntervalRef = useRef(null)
  const prevMessageRef = useRef(null)
  const audioChunksRef = useRef([])
  const fileInputRef = useRef(null)

  const normalizedRoomId = (profile.roomId || 'couple-room').trim().toLowerCase().replace(/\s+/g, '-') || 'couple-room'

  const toggleSettings = () => setSettingsOpen((current) => !current)

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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setVoiceMessageStatus('Processing')
    }
  }

  const startRecording = async () => {
    setRecordingError('')
    if (isRecording) {
      stopRecording()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const mediaRecorder = new window.MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      setIsRecording(true)
      setVoiceMessageStatus('Recording')
      setRecordedAudioUrl(null)
      setRecordingDuration(0)

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const audioUrl = URL.createObjectURL(audioBlob)
        setRecordedAudioUrl(audioUrl)
        setVoiceMessageStatus('Recorded')
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start()
      const startTime = Date.now()
      const interval = window.setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTime) / 1000))
      }, 500)

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const audioUrl = URL.createObjectURL(audioBlob)
        setRecordedAudioBlob(audioBlob)
        setRecordedAudioUrl(audioUrl)
        setVoiceMessageStatus('Recorded')
        stream.getTracks().forEach((track) => track.stop())
        window.clearInterval(interval)
        recordingIntervalRef.current = null
      }
    } catch (error) {
      console.error(error)
      setRecordingError('Unable to record voice message. Please allow microphone access.')
      setIsRecording(false)
      setVoiceMessageStatus('Ready')
    }
  }

  const uploadFile = async (file) => {
    if (!file) {
      return
    }

    setUploadError('')

    const reader = new FileReader()
    reader.onload = async () => {
      const attachment = {
        name: file.name,
        type: file.type,
        data: reader.result,
      }

      const nextMessage = {
        id: `local-${Date.now()}`,
        senderId: profile.name,
        senderName: profile.name,
        text: file.type.startsWith('image/') ? '📷 Image' : '📎 File',
        messageType: file.type.startsWith('image/') ? 'image' : 'file',
        attachment,
      }

      const nextMessages = [...messages, nextMessage]
      saveMessages(nextMessages, normalizedRoomId)

      if (db && firebaseReady) {
        await addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
          ...nextMessage,
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
            message: nextMessage.text,
            senderId: profile.name,
            senderName: profile.name,
            messageType: nextMessage.messageType,
            attachment,
          }),
        })

        if (response.ok) {
          const remoteMessages = await response.json()
          saveMessages(remoteMessages, normalizedRoomId)
        }
      } catch (error) {
        console.error(error)
        setUploadError('Unable to upload file. Please try again.')
      }
    }

    reader.readAsDataURL(file)
  }

  const sendVoiceMessage = async () => {
    if (!recordedAudioUrl || !recordedAudioBlob) {
      return
    }

    const attachment = {
      name: `voice-${Date.now()}.webm`,
      type: recordedAudioBlob.type,
      data: await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(recordedAudioBlob)
      }),
    }

    const nextMessage = {
      id: `local-${Date.now()}`,
      senderId: profile.name,
      senderName: profile.name,
      text: '🎤 Voice message',
      messageType: 'audio',
      attachment,
    }

    const nextMessages = [...messages, nextMessage]
    saveMessages(nextMessages, normalizedRoomId)
    setRecordedAudioBlob(null)
    setRecordedAudioUrl(null)
    setVoiceMessageStatus('Ready')
    setRecordingDuration(0)

    if (db && firebaseReady) {
      await addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
        ...nextMessage,
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
          message: nextMessage.text,
          senderId: profile.name,
          senderName: profile.name,
          messageType: nextMessage.messageType,
          attachment,
        }),
      })

      if (response.ok) {
        const remoteMessages = await response.json()
        saveMessages(remoteMessages, normalizedRoomId)
      }
    } catch (error) {
      console.error(error)
      setUploadError('Unable to send voice message. Please try again.')
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

    messageListRef.current.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return
    }

    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return
    }

    if (!messages.length || !profile.name) {
      prevMessageRef.current = messages[messages.length - 1] || null
      return
    }

    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || prevMessageRef.current?.id === lastMessage.id) {
      return
    }

    if (lastMessage.senderId !== profile.name && Notification.permission === 'granted') {
      const messageText = lastMessage.text || 'New message'
      const notificationBody = lastMessage.messageType === 'audio'
        ? 'Voice message received'
        : lastMessage.messageType === 'image'
          ? 'Photo received'
          : messageText

      new Notification(lastMessage.senderName || 'New message', {
        body: notificationBody,
        silent: true,
      })
    }

    prevMessageRef.current = lastMessage
  }, [messages, profile.name])

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
        text: `Welcome ${name}! Use room ${roomId} on both devices to chat, send voice messages, and share files.`,
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
    setRecordedAudioBlob(null)
    setRecordedAudioUrl(null)
    setVoiceMessageStatus('Ready')
    setRecordingDuration(0)

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
          <p className="auth-copy">Set your name, add your partner, and use the same room name on both phones to chat, send voice messages, and share photos or files.</p>

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
      <main className="chat-panel">
        <div className="chat-top-nav">
          <div className="top-nav-row">
            <div className="top-nav-tabs">
              <button className="nav-tab active">Chat</button>
            </div>
            <div className="top-nav-identity">
              <span>{profile.partnerName || 'Private room'}</span>
              <button className="ghost-btn" onClick={startRecording}>
                {isRecording ? '⏹️ Stop recording' : '🎙️ Record voice'}
              </button>
              <button className="ghost-btn settings-btn" onClick={toggleSettings} aria-label="Open settings">
                ⚙️
              </button>
            </div>
          </div>
          <div className="nav-divider" />
          <div className="nav-divider subtle" />
        </div>

        {settingsOpen ? (
          <div className="settings-drawer">
            <div className="settings-shell">
              <div className="settings-header">
                <div>
                  <p className="eyebrow">Settings</p>
                  <h2>Your chat settings</h2>
                </div>
                <button className="secondary-btn" onClick={toggleSettings}>Close</button>
              </div>

              <div className="profile-card settings-profile">
                <div className="avatar">💕</div>
                <div>
                  <h2>{profile.name}</h2>
                  <p>{profile.partnerName ? `Chatting with ${profile.partnerName}` : 'Private and secure'}</p>
                </div>
              </div>

              <div className="sidebar-section settings-panel">
                <h3>Quick actions</h3>
                <button className="sidebar-btn" onClick={() => { startRecording(); setSettingsOpen(false) }}>
                  🎙️ Record voice message
                </button>
                <button className="sidebar-btn" onClick={() => fileInputRef.current?.click()}>
                  📎 Upload file/photo
                </button>
                <button className="sidebar-btn secondary-logout" onClick={() => { handleSignOut(); setSettingsOpen(false) }}>
                  ↪ Sign out
                </button>
              </div>

              <div className="status-box settings-status">
                <div className="status-pill">{firebaseReady ? 'Cloud synced' : 'Local mode'}</div>
                <p>Room: {normalizedRoomId}</p>
                <p>{channelReady ? 'Live sync ready' : 'Preparing sync'}</p>
              </div>
            </div>
          </div>
        ) : null}

        {recordingError ? <p className="call-error">{recordingError}</p> : null}
        {uploadError ? <p className="call-error">{uploadError}</p> : null}
        {recordedAudioUrl ? (
          <div className="recording-preview">
            <p>Recorded voice message ({recordingDuration}s)</p>
            <audio controls src={recordedAudioUrl} />
            <div className="recording-actions">
              <button className="sidebar-btn" type="button" onClick={sendVoiceMessage}>Send voice message</button>
              <button className="secondary-btn" type="button" onClick={() => { setRecordedAudioUrl(null); setVoiceMessageStatus('Ready'); setRecordingDuration(0) }}>Discard</button>
            </div>
          </div>
        ) : null}

        <section className="message-list" aria-label="conversation messages" ref={messageListRef}>
          {messages.map((message) => {
            const isMine = message.senderId === profile.name
            const isSystem = message.senderId === 'system'
            return (
              <article key={message.id} className={`message-bubble ${isSystem ? 'system' : isMine ? 'me' : 'her'}`}>
                {!isSystem ? <div className="message-meta">{message.senderName}</div> : null}
                <div>
                  {message.text}
                  {message.attachment ? (
                    message.messageType === 'image' ? (
                      <img className="message-image" src={message.attachment.data} alt={message.attachment.name} />
                    ) : message.messageType === 'audio' ? (
                      <audio controls src={message.attachment.data} />
                    ) : (
                      <a className="attachment-link" href={message.attachment.data} download={message.attachment.name}>{message.attachment.name}</a>
                    )
                  ) : null}
                </div>
              </article>
            )
          })}
        </section>

        <form className="composer" onSubmit={sendMessage}>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                uploadFile(file)
                event.target.value = ''
              }
            }}
          />
          <button className="composer-action" type="button" onClick={() => fileInputRef.current?.click()}>
            📎
          </button>
          <button className="composer-action" type="button" onClick={startRecording}>
            🎤
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
