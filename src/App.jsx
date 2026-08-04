import { useEffect, useRef, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db, firebaseReady } from './firebase'
import './App.css'
import { applyReadReceipts, getMessageStatus, hydrateMessagesWithAttachments, mergeMessages, persistMessages } from './messageUtils'

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
  phoneNumber: '',
}

const createMessageClientId = () => `client-${Date.now()}-${Math.random().toString(16).slice(2)}`

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
    phoneNumber: profile.phoneNumber || '',
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
  const [lightboxImage, setLightboxImage] = useState(null)
  const [pendingAttachment, setPendingAttachment] = useState(null)
  const [replyToMessage, setReplyToMessage] = useState(null)
  const [peerTyping, setPeerTyping] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null)
  const [canInstall, setCanInstall] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  const channelRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const messageListRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordingIntervalRef = useRef(null)
  const prevMessageRef = useRef(null)
  const initialMessagesLoadedRef = useRef(false)
  const audioChunksRef = useRef([])
  const galleryInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const messageInputRef = useRef(null)

  const syncMessageInputHeight = () => {
    const input = messageInputRef.current
    if (!input) {
      return
    }

    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }

  useEffect(() => {
    syncMessageInputHeight()
  }, [draft])

  useEffect(() => {
    if (isSignedUp) {
      window.requestAnimationFrame(() => {
        if (messageInputRef.current) {
          messageInputRef.current.focus()
          syncMessageInputHeight()
        }
      })
    }
  }, [isSignedUp])

  const scrollToBottom = () => {
    if (!messageListRef.current) {
      return
    }

    const scroll = () => {
      if (!messageListRef.current) {
        return
      }
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight
    }

    window.requestAnimationFrame(() => {
      scroll()
      window.setTimeout(scroll, 60)
    })

    setShowScrollToBottom(false)
  }

  const normalizedRoomId = (profile.roomId || 'couple-room').trim().toLowerCase().replace(/\s+/g, '-') || 'couple-room'

  const toggleSettings = () => setSettingsOpen((current) => !current)

  const saveMessages = (nextMessages, roomId) => {
    setMessages((currentMessages) => {
      const mergedMessages = mergeMessages(currentMessages, nextMessages)

      if (typeof window !== 'undefined') {
        persistMessages(roomId, mergedMessages, window.localStorage)
      }

      if (channelRef.current) {
        channelRef.current.postMessage({ type: 'message-sync', roomId, messages: mergedMessages })
      }

      window.requestAnimationFrame(() => {
        scrollToBottom()
      })

      return mergedMessages
    })
  }

  const markMessageDelivered = (clientId) => {
    setMessages((currentMessages) => {
      const nextMessages = currentMessages.map((message) => {
        if (message.clientId !== clientId && message.id !== clientId) {
          return message
        }

        return {
          ...message,
          status: 'delivered',
          delivered: true,
          read: false,
        }
      })

      if (typeof window !== 'undefined') {
        persistMessages(normalizedRoomId, nextMessages, window.localStorage)
      }

      return nextMessages
    })
  }

  const beginReplyToMessage = (message) => {
    setReplyToMessage(message)
    if (messageInputRef.current) {
      messageInputRef.current.focus()
    }
  }

  const updateMessageStatus = (messageKey, nextStatus) => {
    setMessages((currentMessages) => {
      const nextMessages = currentMessages.map((message) => {
        if (message.clientId !== messageKey && message.id !== messageKey) {
          return message
        }

        return {
          ...message,
          read: nextStatus === 'seen',
          delivered: nextStatus === 'delivered' || nextStatus === 'seen',
          status: nextStatus,
        }
      })

      if (typeof window !== 'undefined') {
        persistMessages(normalizedRoomId, nextMessages, window.localStorage)
      }

      return nextMessages
    })
  }

  const sendReadReceipt = async (messageIds) => {
    if (!messageIds.length || !profile.name || typeof window === 'undefined') {
      return
    }

    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'read-receipt',
        roomId: normalizedRoomId,
        senderId: profile.name,
        messageIds,
      })
    }

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          readMessageIds: messageIds,
          read: true,
        }),
      })
    } catch {
      // best-effort only
    }

    if (db && firebaseReady) {
      try {
        await Promise.all(messageIds.map((messageId) => updateDoc(doc(db, 'rooms', normalizedRoomId, 'messages', messageId), { read: true })))
      } catch {
        // best-effort only
      }
    }
  }

  const markIncomingMessagesRead = async (incomingMessages = messages) => {
    if (typeof window === 'undefined' || !profile.name) {
      return
    }

    const unreadIncoming = incomingMessages.filter((message) => message.senderId !== profile.name && !message.read)
    if (!unreadIncoming.length) {
      return
    }

    const nextMessages = applyReadReceipts(incomingMessages, unreadIncoming.map((message) => message.id))
    saveMessages(nextMessages, normalizedRoomId)
    await sendReadReceipt(unreadIncoming.map((message) => message.id))
  }

  const sendTypingUpdate = (isTyping) => {
    if (!channelRef.current || !profile.name) {
      return
    }

    channelRef.current.postMessage({
      type: 'typing',
      roomId: normalizedRoomId,
      senderId: profile.name,
      isTyping,
    })
  }

  const scheduleTypingTimeout = () => {
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      setPeerTyping(false)
    }, 2200)
  }

  const saveProfile = (nextProfile) => {
    setProfile(nextProfile)
    setFormValues({
      name: nextProfile.name,
      partnerName: nextProfile.partnerName,
      roomId: nextProfile.roomId,
      phoneNumber: nextProfile.phoneNumber || '',
    })

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('m3ssaging-profile', JSON.stringify(nextProfile))
    }
  }

  const showNotification = async (title, options = {}) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
      return
    }

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        registration.showNotification(title, { ...options })
        return
      }
    }

    try {
      new Notification(title, { ...options })
    } catch {
      // ignore notification errors
    }
  }

  const requestNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        showNotification('Notifications enabled', {
          body: 'You will receive alerts when new messages arrive.',
        })
      }
    }
  }

  const openLightboxImage = (src, alt) => {
    setLightboxImage({ src, alt })
  }

  const closeLightboxImage = () => {
    setLightboxImage(null)
  }

  const playNotificationSound = () => {
    if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) {
      return
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const audioCtx = new AudioCtx()
      if (audioCtx.state === 'suspended') {
        void audioCtx.resume()
      }

      const oscillator = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 780
      gain.gain.value = 0.05
      oscillator.connect(gain)
      gain.connect(audioCtx.destination)
      oscillator.start()
      oscillator.stop(audioCtx.currentTime + 0.08)
    } catch {
      // ignore audio play errors
    }
  }

  const getRecorderMimeType = () => {
    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      return 'audio/webm'
    }

    if (window.MediaRecorder.isTypeSupported?.('audio/mp4')) {
      return 'audio/mp4'
    }

    if (window.MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')) {
      return 'audio/webm;codecs=opus'
    }

    return 'audio/webm'
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setVoiceMessageStatus('Processing')
    }
  }

  const promptInstall = async () => {
    if (!deferredInstallPrompt) {
      return
    }

    deferredInstallPrompt.prompt()
    const choiceResult = await deferredInstallPrompt.userChoice
    if (choiceResult.outcome === 'accepted') {
      setCanInstall(false)
      setDeferredInstallPrompt(null)
    }
  }

  const startRecording = async () => {
    requestNotificationPermission()
    setRecordingError('')
    if (isRecording) {
      stopRecording()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const recorderMimeType = getRecorderMimeType()
      const mediaRecorder = new window.MediaRecorder(stream, recorderMimeType ? { mimeType: recorderMimeType } : undefined)
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

      mediaRecorder.start()
      const startTime = Date.now()
      const interval = window.setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTime) / 1000))
      }, 500)

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorderMimeType || 'audio/webm' })
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

  const prepareAttachmentForSend = async (file) => {
    if (!file) {
      return
    }

    setUploadError('')

    const reader = new FileReader()
    reader.onload = () => {
      const attachment = {
        name: file.name,
        type: file.type,
        data: reader.result,
      }

      const messageType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'
      const defaultText = file.type.startsWith('image/') ? '📷 Image' : file.type.startsWith('video/') ? '🎬 Video' : '📎 File'

      setPendingAttachment({
        attachment,
        messageType,
        text: defaultText,
      })
    }

    reader.onerror = () => {
      setUploadError('Unable to prepare the selected file. Please try again.')
    }

    reader.readAsDataURL(file)
  }

  const sendPreparedAttachment = async () => {
    if (!pendingAttachment) {
      return
    }

    const nextMessage = {
      id: `local-${Date.now()}`,
      clientId: createMessageClientId(),
      senderId: profile.name,
      senderName: profile.name,
      text: pendingAttachment.text || '📎 File',
      messageType: pendingAttachment.messageType,
      attachment: pendingAttachment.attachment,
      timestamp: Date.now(),
      read: false,
      delivered: false,
      status: 'sent',
      replyTo: replyToMessage ? {
        id: replyToMessage.id,
        senderName: replyToMessage.senderName || 'Someone',
        text: replyToMessage.text || (replyToMessage.messageType === 'image' ? 'Photo' : replyToMessage.messageType === 'audio' ? 'Voice message' : 'Message'),
        messageType: replyToMessage.messageType || 'text',
      } : null,
    }

    const nextMessages = [...messages, nextMessage]
    saveMessages(nextMessages, normalizedRoomId)
    setPendingAttachment(null)
    setReplyToMessage(null)
    setShowScrollToBottom(false)
    scrollToBottom()

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
          clientId: nextMessage.clientId,
          senderId: profile.name,
          senderName: profile.name,
          messageType: nextMessage.messageType,
          attachment: nextMessage.attachment,
          timestamp: nextMessage.timestamp,
          status: nextMessage.status,
          delivered: nextMessage.delivered,
          read: nextMessage.read,
          replyTo: nextMessage.replyTo,
        }),
      })

      if (response.ok) {
        const remoteMessages = await response.json()
        saveMessages(remoteMessages, normalizedRoomId)
      }
    } catch (error) {
      console.error(error)
      setUploadError('Unable to send file. Please try again.')
    }
  }

  const sendVoiceMessage = async () => {
    if (!recordedAudioUrl || !recordedAudioBlob) {
      return
    }

    const isMp4Voice = recordedAudioBlob.type.includes('mp4')
    const attachment = {
      name: `voice-${Date.now()}${isMp4Voice ? '.m4a' : '.webm'}`,
      type: recordedAudioBlob.type,
      data: await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(recordedAudioBlob)
      }),
    }

    const nextMessage = {
      id: `local-${Date.now()}`,
      clientId: createMessageClientId(),
      senderId: profile.name,
      senderName: profile.name,
      text: '🎤 Voice message',
      messageType: 'audio',
      attachment,
      timestamp: Date.now(),
      read: false,
      delivered: false,
      status: 'sent',
      replyTo: replyToMessage ? {
        id: replyToMessage.id,
        senderName: replyToMessage.senderName || 'Someone',
        text: replyToMessage.text || (replyToMessage.messageType === 'image' ? 'Photo' : replyToMessage.messageType === 'audio' ? 'Voice message' : 'Message'),
        messageType: replyToMessage.messageType || 'text',
      } : null,
    }

    const nextMessages = [...messages, nextMessage]
    saveMessages(nextMessages, normalizedRoomId)
    setShowScrollToBottom(false)
    scrollToBottom()
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
          clientId: nextMessage.clientId,
          senderId: profile.name,
          senderName: profile.name,
          messageType: nextMessage.messageType,
          attachment,
          timestamp: nextMessage.timestamp,
          status: nextMessage.status,
          delivered: nextMessage.delivered,
          read: nextMessage.read,
          replyTo: nextMessage.replyTo,
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

    let unsubscribeFirebase = null

    if (db && firebaseReady) {
      const messagesRef = collection(db, 'rooms', normalizedRoomId, 'messages')
      const q = query(messagesRef, orderBy('createdAt', 'asc'))

      unsubscribeFirebase = onSnapshot(q, (snapshot) => {
        const nextMessages = snapshot.docs.map((doc) => ({
          id: doc.id,
          clientId: doc.data().clientId || null,
          senderId: doc.data().senderId || 'unknown',
          senderName: doc.data().senderName || 'Someone',
          text: doc.data().text || '',
          messageType: doc.data().messageType || 'text',
          attachment: doc.data().attachment || null,
          timestamp: doc.data().timestamp || doc.data().createdAt?.toMillis?.() || Date.now(),
          read: Boolean(doc.data().read),
          delivered: Boolean(doc.data().delivered || doc.data().read),
          status: doc.data().status || (doc.data().read ? 'seen' : doc.data().delivered ? 'delivered' : 'sent'),
          replyTo: doc.data().replyTo || null,
        }))

        setMessages((currentMessages) => mergeMessages(currentMessages, nextMessages))
      })
    }

    const loadMessages = async () => {
      const savedMessages = window.localStorage.getItem(`m3ssaging-messages:${normalizedRoomId}`)
      if (savedMessages) {
        try {
          const parsedMessages = JSON.parse(savedMessages)
          if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
            setMessages(hydrateMessagesWithAttachments(normalizedRoomId, parsedMessages, window.localStorage))
          }
        } catch {
          setMessages(demoMessages)
        }
      }

      const remoteMessages = await syncMessagesFromApi(normalizedRoomId)
      if (remoteMessages.length > 0) {
        const normalizedRemoteMessages = remoteMessages.map((message) => ({
          ...message,
          timestamp: message.timestamp || Date.now(),
          read: Boolean(message.read),
          delivered: Boolean(message.delivered || message.read),
          status: message.status || (message.read ? 'seen' : message.delivered ? 'delivered' : 'sent'),
          replyTo: message.replyTo || null,
        }))
        const savedMessages = window.localStorage.getItem(`m3ssaging-messages:${normalizedRoomId}`)
        const existingMessages = savedMessages ? JSON.parse(savedMessages) : []
        const mergedMessages = mergeMessages(existingMessages, normalizedRemoteMessages)
        const hydratedMessages = hydrateMessagesWithAttachments(normalizedRoomId, mergedMessages, window.localStorage)
        setMessages(hydratedMessages)
        window.localStorage.setItem(`m3ssaging-messages:${normalizedRoomId}`, JSON.stringify(hydratedMessages))
      }

      if (profile.name) {
        const unreadMessages = messages.filter((message) => message.senderId !== profile.name && !message.read)
        if (unreadMessages.length) {
          await sendReadReceipt(unreadMessages.map((message) => message.id))
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
      if (event.data.roomId !== normalizedRoomId) {
        return
      }

      if (event.data.type === 'message-sync') {
        setMessages((currentMessages) => mergeMessages(currentMessages, event.data.messages))
        return
      }

      if (event.data.type === 'read-receipt' && event.data.senderId !== profile.name) {
        setMessages((currentMessages) => applyReadReceipts(currentMessages, event.data.messageIds || []))
        return
      }

      if (event.data.type === 'typing' && event.data.senderId !== profile.name) {
        setPeerTyping(event.data.isTyping)
        if (event.data.isTyping) {
          scheduleTypingTimeout()
        }
      }
    }

    return () => {
      unsubscribeFirebase?.()
      window.clearInterval(intervalId)
      channel.close()
    }
  }, [profile.name, normalizedRoomId])

  useEffect(() => {
    if (!messageListRef.current) {
      return
    }

    if (!showScrollToBottom) {
      messageListRef.current.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages, showScrollToBottom])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleViewportResize = () => {
      if (messageListRef.current) {
        window.setTimeout(() => {
          messageListRef.current?.scrollTo({
            top: messageListRef.current.scrollHeight,
            behavior: 'smooth',
          })
        }, 100)
      }
    }

    window.visualViewport?.addEventListener('resize', handleViewportResize)
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setDeferredInstallPrompt(event)
      setCanInstall(true)
    }

    const handleAppInstalled = () => {
      setIsInstalled(true)
      setCanInstall(false)
      setDeferredInstallPrompt(null)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void markIncomingMessagesRead()
      }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [normalizedRoomId, profile.name])

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return
    }

    if (!messages.length || !profile.name) {
      prevMessageRef.current = messages[messages.length - 1] || null
      return
    }

    if (!initialMessagesLoadedRef.current) {
      prevMessageRef.current = messages[messages.length - 1]
      initialMessagesLoadedRef.current = true
      void markIncomingMessagesRead(messages)
      return
    }

    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || prevMessageRef.current?.id === lastMessage.id) {
      return
    }

    if (lastMessage.senderId !== profile.name && document.visibilityState !== 'visible') {
      const messageText = lastMessage.text || 'New message'
      const notificationBody = lastMessage.messageType === 'audio'
        ? 'Voice message received'
        : lastMessage.messageType === 'image'
          ? 'Photo received'
          : messageText

      playNotificationSound()
      void showNotification(lastMessage.senderName || 'New message', {
        body: notificationBody,
        icon: '/favicon.ico',
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
    void requestNotificationPermission()
    setDraft('')

    window.requestAnimationFrame(() => {
      if (messageInputRef.current) {
        messageInputRef.current.focus()
        syncMessageInputHeight()
      }
    })
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
    if (event?.preventDefault) {
      event.preventDefault()
    }

    if (!draft.trim() || !profile.name) {
      return
    }

    const trimmedMessage = draft.trim()
    const nextMessage = {
      id: `local-${Date.now()}`,
      clientId: createMessageClientId(),
      senderId: profile.name,
      senderName: profile.name,
      text: trimmedMessage,
      timestamp: Date.now(),
      read: false,
      delivered: false,
      status: 'sent',
      replyTo: replyToMessage ? {
        id: replyToMessage.id,
        senderName: replyToMessage.senderName || 'Someone',
        text: replyToMessage.text || (replyToMessage.messageType === 'image' ? 'Photo' : replyToMessage.messageType === 'audio' ? 'Voice message' : 'Message'),
        messageType: replyToMessage.messageType || 'text',
      } : null,
    }

    const nextMessages = [...messages, nextMessage]
    saveMessages(nextMessages, normalizedRoomId)
    setDraft('')
    setReplyToMessage(null)
    sendTypingUpdate(false)
    setShowScrollToBottom(false)
    scrollToBottom()

    window.requestAnimationFrame(() => {
      if (messageInputRef.current) {
        messageInputRef.current.focus()
        const length = messageInputRef.current.value.length
        messageInputRef.current.setSelectionRange(length, length)
        syncMessageInputHeight()
      }
    })

    if (db && firebaseReady) {
      await addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
        text: trimmedMessage,
        senderId: profile.name,
        senderName: profile.name,
        createdAt: serverTimestamp(),
        timestamp: Date.now(),
        status: 'delivered',
        delivered: true,
        read: false,
        replyTo: nextMessage.replyTo,
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
          clientId: nextMessage.clientId,
          senderId: profile.name,
          senderName: profile.name,
          messageType: 'text',
          timestamp: nextMessage.timestamp,
          status: 'delivered',
          delivered: true,
          read: false,
          replyTo: nextMessage.replyTo,
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
              <span>Phone number</span>
              <input
                type="tel"
                value={formValues.phoneNumber}
                onChange={(event) => setFormValues((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                placeholder="+1 555 123 4567"
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
                        <button className="sidebar-btn" onClick={() => galleryInputRef.current?.click()}>
                  📎 Upload file/photo
                </button>
                {typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted' ? (
                  <button className="sidebar-btn" onClick={() => requestNotificationPermission()}>
                    🔔 Enable notifications
                  </button>
                ) : null}
                {canInstall && !isInstalled ? (
                  <button className="sidebar-btn" onClick={promptInstall}>
                    ⬇️ Install app
                  </button>
                ) : null}
                {isInstalled ? (
                  <div className="status-box settings-status">App installed</div>
                ) : null}
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

        <section
          className="message-list"
          aria-label="conversation messages"
          ref={messageListRef}
          onScroll={() => {
            if (!messageListRef.current) {
              return
            }

            const scrollContainer = messageListRef.current
            const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
            setShowScrollToBottom(distanceFromBottom > 120)
          }}
        >
          {messages.map((message) => {
            const isMine = message.senderId === profile.name
            const isSystem = message.senderId === 'system'
            return (
              <article
                key={message.id}
                className={`message-row ${isMine ? 'mine' : 'their'}`}
                onTouchStart={(event) => {
                  if (event.touches?.[0]) {
                    event.currentTarget.dataset.touchStartX = String(event.touches[0].clientX)
                  }
                }}
                onTouchEnd={(event) => {
                  const startX = Number(event.currentTarget.dataset.touchStartX || '0')
                  const endX = event.changedTouches?.[0]?.clientX ?? 0
                  if (endX - startX > 90) {
                    beginReplyToMessage(message)
                  }
                  delete event.currentTarget.dataset.touchStartX
                }}
              >
                <div className={`message-bubble ${isSystem ? 'system' : isMine ? 'me' : 'her'}`}>
                  {!isSystem ? <div className="message-meta">{message.senderName}</div> : null}
                  <div>
                    {message.replyTo ? (
                      <div className="reply-preview-chip">
                        <span>Replying to {message.replyTo.senderName || 'message'}</span>
                        <strong>{message.replyTo.text || (message.replyTo.messageType === 'image' ? 'Photo' : message.replyTo.messageType === 'audio' ? 'Voice message' : 'Message')}</strong>
                      </div>
                    ) : null}
                    {message.text ? <p>{message.text}</p> : null}
                    {message.attachment ? (
                      message.messageType === 'image' ? (
                        <div className="attachment-preview">
                          <img
                            className="message-image"
                            src={message.attachment.data}
                            alt={message.attachment.name}
                          />
                          <button
                            className="photo-view-btn"
                            type="button"
                            onClick={() => openLightboxImage(message.attachment.data, message.attachment.name)}
                          >
                            View photo
                          </button>
                        </div>
                      ) : message.messageType === 'audio' ? (
                        <audio controls playsInline preload="metadata" src={message.attachment.data} />
                      ) : message.messageType === 'video' ? (
                        <video className="message-video" controls src={message.attachment.data} />
                      ) : (
                        <a className="attachment-link" href={message.attachment.data} download={message.attachment.name}>{message.attachment.name}</a>
                      )
                    ) : null}
                    <div className="status-row">
                      <div className="message-timestamp">
                        {message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                      {isMine ? (
                        <div
                          className={`message-status ${getMessageStatus(message)}`}
                          aria-label={getMessageStatus(message) === 'seen' ? 'Seen by partner' : getMessageStatus(message) === 'delivered' ? 'Delivered' : 'Sent'}
                          title={getMessageStatus(message) === 'seen' ? 'Seen by partner' : getMessageStatus(message) === 'delivered' ? 'Delivered' : 'Sent'}
                        >
                          {getMessageStatus(message) === 'seen' || getMessageStatus(message) === 'delivered' ? '✓✓' : '✓'}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
          {peerTyping ? (
            <div className="typing-indicator">
              {profile.partnerName || 'Partner'} is typing...
            </div>
          ) : null}
        </section>

        {lightboxImage ? (
          <div className="lightbox-overlay" onClick={closeLightboxImage}>
            <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
              <button className="lightbox-close" type="button" onClick={closeLightboxImage} aria-label="Close image view">✕</button>
              <img src={lightboxImage.src} alt={lightboxImage.alt} />
              <div className="lightbox-actions">
                <a className="lightbox-download" href={lightboxImage.src} download={lightboxImage.alt || 'photo'}>
                  Save photo
                </a>
              </div>
            </div>
          </div>
        ) : null}

        {pendingAttachment ? (
          <div className="composer-preview">
            <div className="attachment-card">
              <span>{pendingAttachment.messageType === 'image' ? 'Photo' : pendingAttachment.messageType === 'video' ? 'Video' : 'File'}</span>
              <strong>{pendingAttachment.attachment.name}</strong>
              <button className="clear-btn" type="button" onClick={() => setPendingAttachment(null)}>Cancel</button>
            </div>
            {pendingAttachment.messageType === 'image' ? (
              <img className="preview-image" src={pendingAttachment.attachment.data} alt={pendingAttachment.attachment.name} />
            ) : null}
            <label className="input-group compact">
              <span>Edit caption</span>
              <input
                type="text"
                value={pendingAttachment.text}
                onChange={(event) => setPendingAttachment((current) => ({ ...current, text: event.target.value }))}
                placeholder="Add a caption before sending"
              />
            </label>
            <div className="preview-actions">
              <button className="secondary-btn" type="button" onClick={sendPreparedAttachment}>Send now</button>
              <button className="ghost-btn" type="button" onClick={() => cameraInputRef.current?.click()}>Retake</button>
            </div>
          </div>
        ) : null}

        <form className="composer" onSubmit={sendMessage}>
          {showScrollToBottom ? (
            <button className="composer-action" type="button" onClick={scrollToBottom}>
              ⬇️
            </button>
          ) : null}
          {replyToMessage ? (
            <div className="composer-reply-preview">
              <span>Replying to {replyToMessage.senderName || 'message'}</span>
              <strong>{replyToMessage.text || (replyToMessage.messageType === 'image' ? 'Photo' : replyToMessage.messageType === 'audio' ? 'Voice message' : 'Message')}</strong>
            </div>
          ) : null}
          <input
            type="file"
            ref={galleryInputRef}
            accept="image/*,video/*,audio/*"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void prepareAttachmentForSend(file)
                event.target.value = ''
              }
            }}
          />
          <input
            type="file"
            ref={cameraInputRef}
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void prepareAttachmentForSend(file)
                event.target.value = ''
              }
            }}
          />
          <div className="composer-input-row">
            <button className="composer-action" type="button" onClick={() => galleryInputRef.current?.click()} aria-label="Attach file">
              📎
            </button>
            <button className="composer-action" type="button" onClick={() => cameraInputRef.current?.click()} aria-label="Take photo">
              📷
            </button>
            <button
              className="composer-action"
              type="button"
              onClick={startRecording}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            >
              {isRecording ? '⬇️' : '🎤'}
            </button>
            <textarea
              ref={messageInputRef}
              rows={1}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                syncMessageInputHeight()
                sendTypingUpdate(true)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return
                }

                if (event.shiftKey) {
                  return
                }

                event.preventDefault()
                void sendMessage(event)
              }}
              onFocus={() => {
                syncMessageInputHeight()
                window.setTimeout(() => {
                  messageListRef.current?.scrollTo({
                    top: messageListRef.current.scrollHeight,
                    behavior: 'smooth',
                  })
                }, 100)
              }}
              onInput={(event) => {
                syncMessageInputHeight()
                sendTypingUpdate(true)
              }}
              placeholder="Type a message..."
              aria-label="message input"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              inputMode="text"
            />
            <button className="composer-send-btn" type="submit" aria-label="Send message">➤</button>
          </div>
        </form>
      </main>
    </div>
  )
}

export default App
