import { useEffect, useRef, useState } from 'react'
import { firebaseReady, loadFirebaseServices } from './firebase'
import './App.css'
import { applyDeliveredReceipts, applyReadReceipts, getMessageReactionSummary, getMessageStatus, getPresenceLabel, hydrateMessagesWithAttachments, isPresenceFresh, mergeMessages, mergeRemoteMessageSet, persistMessages, removeMessagesByIdentity, retryAsync, toggleMessageReaction, updateMessageByIdentity } from './messageUtils'

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

const MAX_IMAGE_DIMENSION = 1600
const TARGET_IMAGE_BLOB_SIZE = 640000

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new Error('Unable to read file'))
  reader.readAsDataURL(file)
})

const loadImageElement = (src) => new Promise((resolve, reject) => {
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Unable to decode image'))
  image.src = src
})

const compressImageFile = async (file) => {
  if (!file || !file.type?.startsWith('image/')) {
    return null
  }

  const sourceDataUrl = await readFileAsDataUrl(file)
  const image = await loadImageElement(sourceDataUrl)
  const sourceWidth = image.naturalWidth || image.width || 1
  const sourceHeight = image.naturalHeight || image.height || 1
  const scaleRatio = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(sourceWidth, 1), MAX_IMAGE_DIMENSION / Math.max(sourceHeight, 1))

  const canvas = document.createElement('canvas')
  const targetWidth = Math.max(1, Math.round(sourceWidth * scaleRatio))
  const targetHeight = Math.max(1, Math.round(sourceHeight * scaleRatio))
  canvas.width = targetWidth
  canvas.height = targetHeight

  const context = canvas.getContext('2d')
  if (!context) {
    return {
      name: file.name,
      type: file.type,
      data: sourceDataUrl,
    }
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const outputMimeType = file.type === 'image/png' ? 'image/jpeg' : file.type
  let quality = 0.82
  let compressedDataUrl = canvas.toDataURL(outputMimeType, quality)

  while (compressedDataUrl.length > TARGET_IMAGE_BLOB_SIZE && quality > 0.45) {
    quality -= 0.08
    compressedDataUrl = canvas.toDataURL(outputMimeType, quality)
  }

  return {
    name: file.name,
    type: outputMimeType,
    data: compressedDataUrl,
  }
}

let activeMessageSync = null

async function syncMessagesFromApi(roomId) {
  if (!roomId) {
    return []
  }

  if (typeof window !== 'undefined' && !window.navigator.onLine) {
    return []
  }

  if (activeMessageSync) {
    return activeMessageSync
  }

  activeMessageSync = (async () => {
    try {
      const response = await fetch(getMessagesApiUrl(roomId), {
        headers: { 'Cache-Control': 'no-cache' },
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error('Unable to sync messages')
      }

      const nextMessages = await response.json()
      return Array.isArray(nextMessages) ? nextMessages : []
    } catch {
      return []
    }
  })()

  try {
    return await activeMessageSync
  } finally {
    activeMessageSync = null
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
  const [voiceRecordLocked, setVoiceRecordLocked] = useState(false)
  const [voiceRecordPaused, setVoiceRecordPaused] = useState(false)
  const [lightboxImage, setLightboxImage] = useState(null)
  const [pendingAttachment, setPendingAttachment] = useState(null)
  const [replyToMessage, setReplyToMessage] = useState(null)
  const [activeMessageAction, setActiveMessageAction] = useState(null)
  const [reactionMenuMessage, setReactionMenuMessage] = useState(null)
  const [editingMessage, setEditingMessage] = useState(null)
  const [editMessageDraft, setEditMessageDraft] = useState('')
  const [partnerPresence, setPartnerPresence] = useState({ online: false, lastActive: 0 })
  const [presenceClock, setPresenceClock] = useState(Date.now())
  const [peerTyping, setPeerTyping] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null)
  const [canInstall, setCanInstall] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  const channelRef = useRef(null)
  const eventSourceRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const firebaseServicesRef = useRef({ db: null, firestore: null })
  const messageListRef = useRef(null)
  const messageHoldTimerRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordingStreamRef = useRef(null)
  const recordingIntervalRef = useRef(null)
  const voiceHoldTimerRef = useRef(null)
  const voicePointerStartRef = useRef({ active: false, x: 0, y: 0 })
  const autoSendRecordingRef = useRef(false)
  const discardRecordingRef = useRef(false)
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

    const previousHeight = input.style.height
    input.style.height = 'auto'
    const nextHeight = Math.min(input.scrollHeight, 120)
    input.style.height = `${nextHeight}px`

    if (previousHeight !== input.style.height && messageListRef.current) {
      window.requestAnimationFrame(() => {
        messageListRef.current?.scrollTo({
          top: messageListRef.current.scrollHeight,
          behavior: 'instant',
        })
      })
    }
  }

  const IconUpload = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 16V4M8.5 7.5 12 4l3.5 3.5" />
      <path d="M4 16.5v1.75A1.75 1.75 0 0 0 5.75 20h12.5A1.75 1.75 0 0 0 20 18.25V16.5" />
    </svg>
  )

  const IconCamera = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2.2l1.2-1.8A1 1 0 0 1 10.8 4h2.4a1 1 0 0 1 .9.6L15.3 6h2.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
      <circle cx="12" cy="12.5" r="3.25" />
    </svg>
  )

  const IconMic = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5a3 3 0 0 1 3 3V12a3 3 0 1 1-6 0V6.5a3 3 0 0 1 3-3Z" />
      <path d="M6 11.5a6 6 0 0 0 12 0" />
      <path d="M12 17.5v3" />
      <path d="M9 20.5h6" />
    </svg>
  )

  const IconSend = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5 18.5 4 15.5 20l-3.4-5.4L5 12.5Z" />
      <path d="M15.5 20 12 12.5" />
    </svg>
  )

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

  const getPresenceSnapshotForPartner = (snapshot = {}) => {
    const remotePresenceEntries = Object.entries(snapshot || {}).filter(([senderId]) => senderId && senderId !== profile.name)
    if (!remotePresenceEntries.length) {
      return { online: false, lastActive: 0 }
    }

    const [, remotePresence] = remotePresenceEntries[0]
    const lastActive = Number(remotePresence?.lastActive || 0)
    const isOnline = Boolean(remotePresence?.online) && Number.isFinite(lastActive) && lastActive > 0 && Date.now() - lastActive <= 60000
    return {
      online: isOnline,
      lastActive,
    }
  }

  const syncPresenceFromApi = async (roomId) => {
    try {
      const response = await fetch(`/api/messages?room=${encodeURIComponent(roomId)}&presence=1`)
      if (!response.ok) {
        return
      }

      const snapshot = await response.json()
      const nextPresence = getPresenceSnapshotForPartner(snapshot)
      setPartnerPresence(nextPresence)
    } catch {
      // best-effort only
    }
  }

  const formatPresenceLabel = (nextPresence = partnerPresence, now = presenceClock) => {
    if (peerTyping) {
      return 'typing...'
    }

    const normalizedPresence = nextPresence && typeof nextPresence === 'object' ? nextPresence : { online: false, lastActive: 0 }
    const lastActive = Number(normalizedPresence.lastActive || 0)
    if (!lastActive || !Number.isFinite(lastActive)) {
      return 'offline'
    }

    const isOnline = Boolean(normalizedPresence.online) && now - lastActive <= 60000
    if (isOnline) {
      return 'online'
    }

    const difference = Math.max(0, now - lastActive)
    if (difference < 60000) {
      return 'last active just now'
    }

    if (difference < 3600000) {
      return `last active ${Math.max(1, Math.floor(difference / 60000))}m ago`
    }

    return `last active ${new Date(lastActive).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }

  const toggleSettings = () => setSettingsOpen((current) => !current)

  const clearMessageHoldTimer = () => {
    if (messageHoldTimerRef.current) {
      window.clearTimeout(messageHoldTimerRef.current)
      messageHoldTimerRef.current = null
    }
  }

  const closeMessageActions = () => {
    setActiveMessageAction(null)
    setReactionMenuMessage(null)
    clearMessageHoldTimer()
  }

  const reactionEmojis = ['👍', '❤️', '😂', '🎉', '😮', '😢']

  const handleReaction = async (message, emoji) => {
    if (!message || !emoji || !profile.name) {
      return
    }

    const updatedMessage = toggleMessageReaction(message, emoji, profile.name)

    setMessages((currentMessages) => {
      const baseMessages = Array.isArray(currentMessages) && currentMessages.length > 0 ? currentMessages : Array.isArray(messages) && messages.length > 0 ? messages : demoMessages
      const nextMessages = updateMessageByIdentity(baseMessages, message, {
        reactions: updatedMessage.reactions,
      })
      const safeMessages = Array.isArray(nextMessages) && nextMessages.length > 0 ? nextMessages : baseMessages

      if (typeof window !== 'undefined') {
        persistMessages(normalizedRoomId, safeMessages, window.localStorage)
      }

      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'message-sync',
          roomId: normalizedRoomId,
          messages: safeMessages,
        })
      }

      return safeMessages
    })

    setReactionMenuMessage(null)
    setActiveMessageAction(null)

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          updateMessage: {
            target: message,
            reactions: updatedMessage.reactions,
            updatedAt: Date.now(),
          },
        }),
      })

      if (response.ok) {
        const remoteMessages = await response.json()
        if (Array.isArray(remoteMessages)) {
          setMessages((currentMessages) => {
            const mergedMessages = mergeRemoteMessageSet(currentMessages, remoteMessages)
            persistMessages(normalizedRoomId, mergedMessages, window.localStorage)
            if (channelRef.current) {
              channelRef.current.postMessage({ type: 'message-sync', roomId: normalizedRoomId, messages: mergedMessages })
            }
            return mergedMessages
          })
        }
      }
    } catch {
      // best-effort only
    }
  }

  const startMessageHold = (message) => {
    if (!message) {
      return
    }

    clearMessageHoldTimer()
    messageHoldTimerRef.current = window.setTimeout(() => {
      setReactionMenuMessage(message)
      if (message.senderId === profile.name) {
        setActiveMessageAction(message)
      } else {
        setActiveMessageAction(null)
      }
    }, 450)
  }

  const commitMessages = (nextMessages, roomId) => {
    setMessages(nextMessages)

    if (typeof window !== 'undefined') {
      persistMessages(roomId, nextMessages, window.localStorage)
    }

    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'message-sync', roomId, messages: nextMessages })
    }

    window.requestAnimationFrame(() => {
      scrollToBottom()
    })
  }

  const markMessageAsSent = (clientId) => {
    setMessages((currentMessages) => currentMessages.map((message) => {
      if (message.clientId !== clientId && message.id !== clientId) {
        return message
      }

      return {
        ...message,
        status: 'sent',
        delivered: false,
        read: false,
      }
    }))
  }

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
    setEditingMessage(null)
    setActiveMessageAction(null)
    if (messageInputRef.current) {
      messageInputRef.current.focus()
    }
  }

  const beginEditMessage = (message) => {
    if (!message || message.senderId !== profile.name) {
      return
    }

    setEditingMessage(message)
    setEditMessageDraft(message.text || '')
    setActiveMessageAction(null)
  }

  const cancelEditMessage = () => {
    setEditingMessage(null)
    setEditMessageDraft('')
  }

  const deleteMessage = async (message) => {
    if (!message || message.senderId !== profile.name) {
      return
    }

    const nextMessages = removeMessagesByIdentity(messages, [message])
    commitMessages(nextMessages, normalizedRoomId)
    setEditingMessage(null)
    setEditMessageDraft('')
    setActiveMessageAction(null)

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          deleteMessageIds: getReceiptTargetIds(message),
        }),
      })
    } catch {
      // best-effort only
    }

    const db = firebaseServicesRef.current.db
    const firestore = firebaseServicesRef.current.firestore
    if (db && firebaseReady && firestore) {
      try {
        const { getDocs, collection, deleteDoc, doc } = firestore
        const snapshot = await getDocs(collection(db, 'rooms', normalizedRoomId, 'messages'))
        const docsToDelete = snapshot.docs.filter((document) => {
          const data = document.data()
          return Boolean(data?.clientId && data.clientId === message.clientId)
            || Boolean(data?.senderId && data?.text === message.text && data?.timestamp === message.timestamp && data?.senderId === message.senderId)
        })

        await Promise.all(docsToDelete.map((document) => deleteDoc(doc(db, 'rooms', normalizedRoomId, 'messages', document.id))))
      } catch {
        // best-effort only
      }
    }
  }

  const saveEditedMessage = async (message) => {
    const nextText = editMessageDraft.trim()
    if (!message || !nextText || message.senderId !== profile.name) {
      return
    }

    const nextMessages = updateMessageByIdentity(messages, message, {
      text: nextText,
      edited: true,
      timestamp: Date.now(),
    })
    commitMessages(nextMessages, normalizedRoomId)
    setEditingMessage(null)
    setEditMessageDraft('')
    setActiveMessageAction(null)

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          updateMessage: {
            target: message,
            text: nextText,
            edited: true,
            updatedAt: Date.now(),
          },
        }),
      })
    } catch {
      // best-effort only
    }

    const db = firebaseServicesRef.current.db
    const firestore = firebaseServicesRef.current.firestore
    if (db && firebaseReady && firestore) {
      try {
        const { getDocs, collection, updateDoc, doc } = firestore
        const snapshot = await getDocs(collection(db, 'rooms', normalizedRoomId, 'messages'))
        const matches = snapshot.docs.filter((document) => {
          const data = document.data()
          return data?.clientId === message.clientId || data?.timestamp === message.timestamp
        })

        await Promise.all(matches.map((document) => updateDoc(doc(db, 'rooms', normalizedRoomId, 'messages', document.id), {
          text: nextText,
          edited: true,
          updatedAt: Date.now(),
        })))
      } catch {
        // best-effort only
      }
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

  const getReceiptTargetIds = (message) => [message?.id, message?.clientId, message?.localId, message?.tempId].filter(Boolean)

  const getReceiptTargetList = (incomingMessages = []) => Array.from(new Set(incomingMessages.flatMap((message) => getReceiptTargetIds(message))))

  const sendDeliveredReceipt = async (messageIds) => {
    const receiptTargets = Array.from(new Set((messageIds || []).flatMap((messageId) => {
      if (typeof messageId === 'string') {
        return [messageId]
      }

      return getReceiptTargetIds(messageId)
    })))

    if (!receiptTargets.length || !profile.name || typeof window === 'undefined') {
      return
    }

    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'delivered-receipt',
        roomId: normalizedRoomId,
        senderId: profile.name,
        messageIds: receiptTargets,
      })
    }

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          senderId: profile.name,
          deliveredMessageIds: receiptTargets,
          read: false,
          delivered: true,
          status: 'delivered',
        }),
      })

      if (response.ok) {
        const remoteMessages = await response.json()
        saveMessages(remoteMessages, normalizedRoomId)
      }
    } catch {
      // best-effort only
    }

    const db = firebaseServicesRef.current.db
    const firestore = firebaseServicesRef.current.firestore
    if (db && firebaseReady && firestore) {
      try {
        const { getDocs, query, collection, where, updateDoc, doc } = firestore
        const clientIdTargets = receiptTargets.filter((target) => typeof target === 'string' && target.startsWith('client-'))
        if (clientIdTargets.length) {
          const receiptQuery = query(collection(db, 'rooms', normalizedRoomId, 'messages'), where('clientId', 'in', clientIdTargets.slice(0, 10)))
          const receiptSnapshot = await getDocs(receiptQuery)
          await Promise.all(receiptSnapshot.docs.map((document) => updateDoc(doc(db, 'rooms', normalizedRoomId, 'messages', document.id), {
            read: false,
            delivered: true,
            status: 'delivered',
          })))
        }
      } catch {
        // best-effort only
      }
    }
  }

  const sendReadReceipt = async (messageIds) => {
    const receiptTargets = Array.from(new Set((messageIds || []).flatMap((messageId) => {
      if (typeof messageId === 'string') {
        return [messageId]
      }

      return getReceiptTargetIds(messageId)
    })))

    if (!receiptTargets.length || !profile.name || typeof window === 'undefined') {
      return
    }

    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'read-receipt',
        roomId: normalizedRoomId,
        senderId: profile.name,
        messageIds: receiptTargets,
      })
    }

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: normalizedRoomId,
          senderId: profile.name,
          readMessageIds: receiptTargets,
          read: true,
          delivered: true,
          status: 'seen',
        }),
      })

      if (response.ok) {
        const remoteMessages = await response.json()
        saveMessages(remoteMessages, normalizedRoomId)
      }
    } catch {
      // best-effort only
    }

    const db = firebaseServicesRef.current.db
    const firestore = firebaseServicesRef.current.firestore
    if (db && firebaseReady && firestore) {
      try {
        const { getDocs, query, collection, where, updateDoc, doc } = firestore
        const clientIdTargets = receiptTargets.filter((target) => typeof target === 'string' && target.startsWith('client-'))
        if (clientIdTargets.length) {
          const receiptQuery = query(collection(db, 'rooms', normalizedRoomId, 'messages'), where('clientId', 'in', clientIdTargets.slice(0, 10)))
          const receiptSnapshot = await getDocs(receiptQuery)
          await Promise.all(receiptSnapshot.docs.map((document) => updateDoc(doc(db, 'rooms', normalizedRoomId, 'messages', document.id), {
            read: true,
            delivered: true,
            status: 'seen',
          })))
        }
      } catch {
        // best-effort only
      }
    }
  }

  const markIncomingMessagesRead = async (incomingMessages = messages) => {
    if (typeof window === 'undefined' || !profile.name) {
      return
    }

    const undeliveredIncoming = incomingMessages.filter((message) => message.senderId !== profile.name && !message.delivered)
    if (undeliveredIncoming.length) {
      const deliveredTargets = getReceiptTargetList(undeliveredIncoming)
      const deliveredMessages = applyDeliveredReceipts(incomingMessages, deliveredTargets)
      saveMessages(deliveredMessages, normalizedRoomId)
      await sendDeliveredReceipt(deliveredTargets)
    }

    const unreadIncoming = incomingMessages.filter((message) => message.senderId !== profile.name && !message.read)
    if (!unreadIncoming.length) {
      return
    }

    const receiptTargets = getReceiptTargetList(unreadIncoming)
    const nextMessages = applyReadReceipts(incomingMessages, receiptTargets)
    saveMessages(nextMessages, normalizedRoomId)
    await sendReadReceipt(receiptTargets)
  }

  const syncIncomingMessages = (incomingMessages) => {
    if (!Array.isArray(incomingMessages) || !incomingMessages.length) {
      return
    }

    setMessages((currentMessages) => {
      const mergedMessages = mergeRemoteMessageSet(currentMessages, incomingMessages)
      persistMessages(normalizedRoomId, mergedMessages, window.localStorage)
      return mergedMessages
    })
    void markIncomingMessagesRead(incomingMessages)
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

  const sendPresenceUpdate = async (online = true) => {
    if (!profile.name) {
      return
    }

    const nextPresence = {
      type: 'presence',
      roomId: normalizedRoomId,
      senderId: profile.name,
      online,
      lastActive: Date.now(),
    }

    if (channelRef.current) {
      channelRef.current.postMessage(nextPresence)
    }

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...nextPresence,
          presence: {
            online,
            lastActive: nextPresence.lastActive,
          },
        }),
      })
    } catch {
      // best-effort only
    }
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

  const getNotificationPayload = (message) => {
    if (!message) {
      return { title: 'New message', body: 'You have a new message.' }
    }

    if (message.messageType === 'audio') {
      return { title: message.senderName || 'New message', body: '🎤 Voice message received' }
    }

    if (message.messageType === 'image') {
      return { title: message.senderName || 'New message', body: '📷 Photo received' }
    }

    if (message.messageType === 'video') {
      return { title: message.senderName || 'New message', body: '🎬 Video received' }
    }

    const textPreview = String(message.text || '').trim()
    return {
      title: message.senderName || 'New message',
      body: textPreview || 'You have a new message.',
    }
  }

  const announceNetworkState = async (online = true) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
      return
    }

    if (document.visibilityState === 'visible') {
      return
    }

    await showNotification(online ? 'Network restored' : 'Connection lost', {
      body: online ? 'M3ssaging is online again and can sync your messages.' : 'You are offline. Messages will retry when the connection is back.',
      tag: online ? 'm3ssaging-network-restored' : 'm3ssaging-network-loss',
      renotify: true,
      requireInteraction: false,
    })
  }

  const showNotification = async (title, options = {}) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
      return
    }

    const notificationOptions = {
      icon: '/favicon.ico',
      tag: `${title}-${Date.now()}`,
      renotify: true,
      ...options,
    }

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        registration.showNotification(title, notificationOptions)
        return
      }
    }

    try {
      new Notification(title, notificationOptions)
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

      const createTone = (frequency, startTime, duration, volume) => {
        const oscillator = audioCtx.createOscillator()
        const gain = audioCtx.createGain()

        oscillator.type = 'triangle'
        oscillator.frequency.setValueAtTime(frequency, startTime)
        gain.gain.setValueAtTime(0.0001, startTime)
        gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

        oscillator.connect(gain)
        gain.connect(audioCtx.destination)
        oscillator.start(startTime)
        oscillator.stop(startTime + duration)
      }

      const now = audioCtx.currentTime
      createTone(780, now, 0.12, 0.07)
      createTone(1040, now + 0.08, 0.14, 0.06)
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

  const stopRecording = ({ autoSend = false, discard = false } = {}) => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return
    }

    autoSendRecordingRef.current = autoSend
    discardRecordingRef.current = discard
    mediaRecorderRef.current.stop()
    setIsRecording(false)
    setVoiceRecordLocked(false)
    setVoiceRecordPaused(false)
    setVoiceMessageStatus(discard ? 'Discarded' : autoSend ? 'Sending' : 'Processing')
  }

  const discardVoiceRecording = () => {
    discardRecordingRef.current = true
    autoSendRecordingRef.current = false

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }

    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
    }

    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl)
    }

    setIsRecording(false)
    setVoiceRecordLocked(false)
    setVoiceRecordPaused(false)
    setRecordedAudioUrl(null)
    setRecordedAudioBlob(null)
    setRecordingDuration(0)
    setVoiceMessageStatus('Ready')
    setRecordingError('')
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
      stopRecording({ autoSend: false })
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      recordingStreamRef.current = stream
      const recorderMimeType = getRecorderMimeType()
      const mediaRecorder = new window.MediaRecorder(stream, recorderMimeType ? { mimeType: recorderMimeType } : undefined)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      autoSendRecordingRef.current = false
      discardRecordingRef.current = false
      setIsRecording(true)
      setVoiceRecordLocked(false)
      setVoiceRecordPaused(false)
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
      recordingIntervalRef.current = interval

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorderMimeType || 'audio/webm' })
        const shouldDiscard = discardRecordingRef.current
        const shouldAutoSend = autoSendRecordingRef.current

        if (shouldDiscard) {
          if (recordedAudioUrl) {
            URL.revokeObjectURL(recordedAudioUrl)
          }
          setRecordedAudioBlob(null)
          setRecordedAudioUrl(null)
          setVoiceMessageStatus('Ready')
          setRecordingDuration(0)
          discardRecordingRef.current = false
          autoSendRecordingRef.current = false
          window.clearInterval(interval)
          recordingIntervalRef.current = null
          if (recordingStreamRef.current) {
            recordingStreamRef.current.getTracks().forEach((track) => track.stop())
            recordingStreamRef.current = null
          }
          return
        }

        const audioUrl = URL.createObjectURL(audioBlob)
        setRecordedAudioBlob(audioBlob)
        setRecordedAudioUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl)
          }
          return audioUrl
        })
        setVoiceMessageStatus('Recorded')
        if (recordingStreamRef.current) {
          recordingStreamRef.current.getTracks().forEach((track) => track.stop())
          recordingStreamRef.current = null
        }
        window.clearInterval(interval)
        recordingIntervalRef.current = null

        if (shouldAutoSend) {
          window.setTimeout(() => {
            void sendVoiceMessage(audioBlob)
          }, 0)
        }

        autoSendRecordingRef.current = false
        discardRecordingRef.current = false
      }
    } catch (error) {
      console.error(error)
      setRecordingError('Unable to record voice message. Please allow microphone access.')
      setIsRecording(false)
      setVoiceRecordLocked(false)
      setVoiceRecordPaused(false)
      setVoiceMessageStatus('Ready')
    }
  }

  const prepareAttachmentForSend = async (file) => {
    if (!file) {
      return
    }

    setUploadError('')

    try {
      const attachment = file.type.startsWith('image/')
        ? await compressImageFile(file)
        : {
            name: file.name,
            type: file.type,
            data: await readFileAsDataUrl(file),
          }

      const messageType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'
      const defaultText = file.type.startsWith('image/') ? '📷 Image' : file.type.startsWith('video/') ? '🎬 Video' : '📎 File'

      setPendingAttachment({
        attachment,
        messageType,
        text: defaultText,
      })
    } catch {
      setUploadError('Unable to prepare the selected file. Please try again.')
    }
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
      status: 'sending',
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

    const db = firebaseServicesRef.current.db
    const firestore = firebaseServicesRef.current.firestore
    if (db && firebaseReady && firestore) {
      try {
        const { addDoc, collection, serverTimestamp } = firestore
        await retryAsync(() => addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
          ...nextMessage,
          createdAt: serverTimestamp(),
        }), { retries: 2, delayMs: 250 })

        setMessages((currentMessages) => currentMessages.map((message) => {
          if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
            return message
          }

          return {
            ...message,
            status: 'sent',
            delivered: false,
            read: false,
          }
        }))
      } catch (error) {
        console.error(error)
        setUploadError('Unable to send file. Please try again.')
        setMessages((currentMessages) => currentMessages.map((message) => {
          if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
            return message
          }

          return {
            ...message,
            status: 'failed',
            delivered: false,
            read: false,
          }
        }))
      }
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
          status: 'sent',
          delivered: false,
          read: false,
          replyTo: nextMessage.replyTo,
        }),
      })

      if (response.ok) {
        const remoteMessages = await response.json()
        saveMessages(remoteMessages, normalizedRoomId)
        markMessageAsSent(nextMessage.clientId)
      } else {
        setMessages((currentMessages) => currentMessages.map((message) => {
          if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
            return message
          }

          return {
            ...message,
            status: 'failed',
            delivered: false,
            read: false,
          }
        }))
      }
    } catch (error) {
      console.error(error)
      setUploadError('Unable to send file. Please try again.')
      setMessages((currentMessages) => currentMessages.map((message) => {
        if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
          return message
        }

        return {
          ...message,
          status: 'failed',
          delivered: false,
          read: false,
        }
      }))
    }
  }

  const handleVoicePressStart = (event) => {
    if (draft.trim()) {
      return
    }

    event.preventDefault()
    voicePointerStartRef.current = { active: true, x: event.clientX, y: event.clientY }
    if (voiceHoldTimerRef.current) {
      window.clearTimeout(voiceHoldTimerRef.current)
    }

    voiceHoldTimerRef.current = window.setTimeout(() => {
      void startRecording()
      voiceHoldTimerRef.current = null
    }, 180)
  }

  const handleVoicePressMove = (event) => {
    if (!voicePointerStartRef.current.active || !isRecording || voiceRecordLocked) {
      return
    }

    const deltaY = event.clientY - voicePointerStartRef.current.y
    if (deltaY < -60) {
      setVoiceRecordLocked(true)
      setVoiceMessageStatus('Locked')
    }
  }

  const handleVoicePressEnd = () => {
    voicePointerStartRef.current.active = false

    if (voiceHoldTimerRef.current) {
      window.clearTimeout(voiceHoldTimerRef.current)
      voiceHoldTimerRef.current = null
    }

    if (isRecording && !voiceRecordLocked) {
      stopRecording({ autoSend: true })
    }
  }

  const toggleVoicePause = () => {
    if (!mediaRecorderRef.current) {
      return
    }

    if (mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause()
      setVoiceRecordPaused(true)
      setVoiceMessageStatus('Paused')
      return
    }

    if (mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume()
      setVoiceRecordPaused(false)
      setVoiceMessageStatus('Recording')
    }
  }

  const sendVoiceMessage = async (audioBlobOverride = recordedAudioBlob) => {
    if (!audioBlobOverride) {
      return
    }

    const audioBlob = audioBlobOverride
    const isMp4Voice = audioBlob.type.includes('mp4')
    const attachment = {
      name: `voice-${Date.now()}${isMp4Voice ? '.m4a' : '.webm'}`,
      type: audioBlob.type,
      data: await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(audioBlob)
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
      status: 'sending',
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
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl)
    }
    setRecordedAudioBlob(null)
    setRecordedAudioUrl(null)
    setVoiceRecordLocked(false)
    setVoiceRecordPaused(false)
    setVoiceMessageStatus('Ready')
    setRecordingDuration(0)

    const db = firebaseServicesRef.current.db
    const firestore = firebaseServicesRef.current.firestore
    if (db && firebaseReady && firestore) {
      try {
        const { addDoc, collection, serverTimestamp } = firestore
        await retryAsync(() => addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
          ...nextMessage,
          createdAt: serverTimestamp(),
        }), { retries: 2, delayMs: 250 })

        setMessages((currentMessages) => currentMessages.map((message) => {
          if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
            return message
          }

          return {
            ...message,
            status: 'sent',
            delivered: false,
            read: false,
          }
        }))
      } catch (error) {
        console.error(error)
        setUploadError('Unable to send voice message. Please try again.')
        setMessages((currentMessages) => currentMessages.map((message) => {
          if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
            return message
          }

          return {
            ...message,
            status: 'failed',
            delivered: false,
            read: false,
          }
        }))
      }
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
          status: 'sent',
          delivered: false,
          read: false,
          replyTo: nextMessage.replyTo,
        }),
      })

      if (response.ok) {
        const remoteMessages = await response.json()
        saveMessages(remoteMessages, normalizedRoomId)
        markMessageAsSent(nextMessage.clientId)
      } else {
        setMessages((currentMessages) => currentMessages.map((message) => {
          if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
            return message
          }

          return {
            ...message,
            status: 'failed',
            delivered: false,
            read: false,
          }
        }))
      }
    } catch (error) {
      console.error(error)
      setUploadError('Unable to send voice message. Please try again.')
      setMessages((currentMessages) => currentMessages.map((message) => {
        if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
          return message
        }

        return {
          ...message,
          status: 'failed',
          delivered: false,
          read: false,
        }
      }))
    }
  }

  useEffect(() => {
    if (!profile.name) {
      setMessages(demoMessages)
      return
    }

    let unsubscribeFirebase = null

    const initializeCloudSync = async () => {
      if (!firebaseReady) {
        return
      }

      const { db, auth } = await loadFirebaseServices()
      if (!db || !auth) {
        return
      }

      firebaseServicesRef.current.db = db
      firebaseServicesRef.current.firestore = await import('firebase/firestore')

      const { collection, onSnapshot, orderBy, query } = firebaseServicesRef.current.firestore
      const messagesRef = collection(db, 'rooms', normalizedRoomId, 'messages')
      const q = query(messagesRef, orderBy('createdAt', 'asc'))

      unsubscribeFirebase = onSnapshot(q, (snapshot) => {
        const nextMessages = snapshot.docs.map((document) => ({
          id: document.id,
          clientId: document.data().clientId || null,
          senderId: document.data().senderId || 'unknown',
          senderName: document.data().senderName || 'Someone',
          text: document.data().text || '',
          messageType: document.data().messageType || 'text',
          attachment: document.data().attachment || null,
          timestamp: document.data().timestamp || document.data().createdAt?.toMillis?.() || Date.now(),
          read: Boolean(document.data().read),
          delivered: Boolean(document.data().delivered || document.data().read),
          status: document.data().status || (document.data().read ? 'seen' : document.data().delivered ? 'delivered' : 'sent'),
          replyTo: document.data().replyTo || null,
        }))

        setMessages((currentMessages) => mergeMessages(currentMessages, nextMessages))
      })
    }

    void initializeCloudSync()

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

      if (firebaseReady && firebaseServicesRef.current.db) {
        return
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
        await markIncomingMessagesRead(hydratedMessages)
      }
    }

    void loadMessages()
    setChannelReady(true)

    let channel = null
    let presenceHeartbeat = null
    let presencePoller = null

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new window.BroadcastChannel(`m3ssaging-${normalizedRoomId}`)
      channelRef.current = channel
    }

    if (typeof window === 'undefined' || !('EventSource' in window) || (firebaseReady && firebaseServicesRef.current.db)) {
      return () => {
        if (presenceHeartbeat) {
          window.clearInterval(presenceHeartbeat)
        }
        if (presencePoller) {
          window.clearInterval(presencePoller)
        }
        if (messageSyncPoller) {
          window.clearInterval(messageSyncPoller)
        }
        channelRef.current?.close()
        channelRef.current = null
      }
    }

    const eventSource = new window.EventSource(`/api/events?room=${encodeURIComponent(normalizedRoomId)}`)
    eventSourceRef.current = eventSource
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload.roomId !== normalizedRoomId) {
          return
        }

        if (payload.type === 'message-sync') {
          setMessages((currentMessages) => mergeRemoteMessageSet(currentMessages, payload.messages || []))
          return
        }

        if (payload.type === 'delivered-receipt' && payload.senderId !== profile.name) {
          setMessages((currentMessages) => applyDeliveredReceipts(currentMessages, payload.messageIds || []))
          return
        }

        if (payload.type === 'read-receipt' && payload.senderId !== profile.name) {
          setMessages((currentMessages) => applyReadReceipts(currentMessages, payload.messageIds || []))
          return
        }

        if (payload.type === 'presence' && payload.senderId !== profile.name) {
          const lastActive = Number(payload.lastActive || Date.now())
          setPartnerPresence({
            online: isPresenceFresh(payload, Date.now()),
            lastActive,
          })
        }
      } catch {
        // best-effort only
      }
    }

    sendPresenceUpdate(true)

    presenceHeartbeat = window.setInterval(() => {
      void sendPresenceUpdate(true)
    }, 15000)

    presencePoller = window.setInterval(() => {
      void syncPresenceFromApi(normalizedRoomId)
    }, 5000)

    const refreshRoomState = () => {
      void syncMessagesFromApi(normalizedRoomId).then((remoteMessages) => {
        syncIncomingMessages(remoteMessages)
      })
      void syncPresenceFromApi(normalizedRoomId)
    }

    const messageSyncPoller = window.setInterval(() => {
      refreshRoomState()
    }, 2000)

    void syncPresenceFromApi(normalizedRoomId)

    if (channel) {
      channel.onmessage = (event) => {
        if (event.data.roomId !== normalizedRoomId) {
          return
        }

        if (event.data.type === 'message-sync') {
          setMessages((currentMessages) => mergeRemoteMessageSet(currentMessages, event.data.messages || []))
          return
        }

        if (event.data.type === 'delivered-receipt' && event.data.senderId !== profile.name) {
          setMessages((currentMessages) => applyDeliveredReceipts(currentMessages, event.data.messageIds || []))
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

        if (event.data.type === 'presence' && event.data.senderId !== profile.name) {
          const lastActive = Number(event.data.lastActive || Date.now())
          setPartnerPresence({
            online: isPresenceFresh(event.data, Date.now()),
            lastActive,
          })
        }
      }
    }

    const handlePageHide = () => {
      void sendPresenceUpdate(false)
    }

    const handleBeforeUnload = () => {
      void sendPresenceUpdate(false)
    }

    const handleOfflineStatus = () => {
      void sendPresenceUpdate(false)
      void announceNetworkState(false)
    }

    const handleOnlineStatus = () => {
      void sendPresenceUpdate(true)
      void announceNetworkState(true)
    }

    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('offline', handleOfflineStatus)
    window.addEventListener('online', handleOnlineStatus)

    return () => {
      unsubscribeFirebase?.()
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      if (presenceHeartbeat) {
        window.clearInterval(presenceHeartbeat)
      }
      if (presencePoller) {
        window.clearInterval(presencePoller)
      }
      if (messageSyncPoller) {
        window.clearInterval(messageSyncPoller)
      }
      if (messageSyncPoller) {
        window.clearInterval(messageSyncPoller)
      }
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('offline', handleOfflineStatus)
      window.removeEventListener('online', handleOnlineStatus)
      channelRef.current?.close()
      channelRef.current = null
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

    const updatePresenceClock = () => setPresenceClock(Date.now())
    updatePresenceClock()
    const presenceClockInterval = window.setInterval(updatePresenceClock, 30000)

    return () => {
      window.clearInterval(presenceClockInterval)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handlePointerDown = (event) => {
      const isInsideMenu = event.target.closest?.('.message-actions-menu')
      const isInsideMessage = event.target.closest?.('.message-row')

      if (!isInsideMenu && !isInsideMessage) {
        closeMessageActions()
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMessageActions()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight || 1
      const vhValue = `${viewportHeight * 0.01}px`
      document.documentElement.style.setProperty('--app-vh', vhValue)
    }

    const handleViewportResize = () => {
      syncViewportHeight()
      if (messageListRef.current) {
        window.setTimeout(() => {
          messageListRef.current?.scrollTo({
            top: messageListRef.current.scrollHeight,
            behavior: 'instant',
          })
        }, 80)
      }
    }

    syncViewportHeight()
    window.addEventListener('resize', handleViewportResize)
    window.visualViewport?.addEventListener('resize', handleViewportResize)
    return () => {
      window.removeEventListener('resize', handleViewportResize)
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
      if (!firebaseServicesRef.current.db || !firebaseReady) {
        refreshRoomState()
      }

      if (document.visibilityState === 'visible') {
        void markIncomingMessagesRead()
      }
    }

    const handleWindowFocus = () => {
      if (!firebaseServicesRef.current.db || !firebaseReady) {
        refreshRoomState()
      }
    }

    const handlePageHide = () => {
      if (!firebaseServicesRef.current.db || !firebaseReady) {
        refreshRoomState()
      }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('pagehide', handlePageHide)
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

    const isIncomingMessage = lastMessage.senderId !== profile.name
    if (isIncomingMessage && document.visibilityState === 'visible') {
      void markIncomingMessagesRead(messages)
    }

    if (isIncomingMessage) {
      const { title, body } = getNotificationPayload(lastMessage)

      playNotificationSound()
      void showNotification(title, {
        body,
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
      status: 'sending',
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

    const db = firebaseServicesRef.current.db
    const firestore = firebaseServicesRef.current.firestore
    if (db && firebaseReady && firestore) {
      try {
        const { addDoc, collection, serverTimestamp } = firestore
        await retryAsync(() => addDoc(collection(db, 'rooms', normalizedRoomId, 'messages'), {
          text: trimmedMessage,
          clientId: nextMessage.clientId,
          senderId: profile.name,
          senderName: profile.name,
          messageType: 'text',
          createdAt: serverTimestamp(),
          timestamp: Date.now(),
          status: 'sent',
          delivered: false,
          read: false,
          replyTo: nextMessage.replyTo,
        }), { retries: 2, delayMs: 250 })

        markMessageAsSent(nextMessage.clientId)
      } catch {
        setMessages((currentMessages) => currentMessages.map((message) => {
          if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
            return message
          }

          return {
            ...message,
            status: 'failed',
            delivered: false,
            read: false,
          }
        }))
      }
      return
    }

    try {
      const remoteMessages = await retryAsync(async () => {
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
            status: 'sent',
            delivered: false,
            read: false,
            replyTo: nextMessage.replyTo,
          }),
        })

        if (!response.ok) {
          throw new Error('Unable to send message')
        }

        return response.json()
      }, { retries: 2, delayMs: 250 })

      saveMessages(remoteMessages, normalizedRoomId)
      markMessageAsSent(nextMessage.clientId)
    } catch {
      setMessages((currentMessages) => currentMessages.map((message) => {
        if (message.clientId !== nextMessage.clientId && message.id !== nextMessage.id) {
          return message
        }

        return {
          ...message,
          status: 'failed',
          delivered: false,
          read: false,
        }
      }))
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
              <div className="identity-text-stack">
                <span>{profile.partnerName || 'Private room'}</span>
                <div className="presence-row">
                  <span className={partnerPresence.online || peerTyping ? 'presence-dot online' : 'presence-dot'} />
                  <small className={partnerPresence.online || peerTyping ? 'presence-online' : 'presence-offline'}>{formatPresenceLabel()}</small>
                </div>
              </div>
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
            const messageStatus = getMessageStatus(message)
            return (
              <article
                key={message.id}
                className={`message-row ${isMine ? 'mine' : 'their'}`}
                onMouseDown={() => startMessageHold(message)}
                onMouseUp={clearMessageHoldTimer}
                onMouseLeave={clearMessageHoldTimer}
                onTouchStart={(event) => {
                  if (event.touches?.[0]) {
                    event.currentTarget.dataset.touchStartX = String(event.touches[0].clientX)
                  }
                  startMessageHold(message)
                }}
                onTouchEnd={(event) => {
                  clearMessageHoldTimer()
                  const startX = Number(event.currentTarget.dataset.touchStartX || '0')
                  const endX = event.changedTouches?.[0]?.clientX ?? 0
                  if (endX - startX > 90) {
                    beginReplyToMessage(message)
                  }
                  delete event.currentTarget.dataset.touchStartX
                }}
                onContextMenu={(event) => {
                  if (isMine) {
                    event.preventDefault()
                    setActiveMessageAction(message)
                  }
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
                    {editingMessage?.id === message.id || editingMessage?.clientId === message.clientId ? (
                      <div className="edit-message-box">
                        <textarea
                          value={editMessageDraft}
                          onChange={(event) => setEditMessageDraft(event.target.value)}
                          rows={3}
                          className="edit-message-input"
                        />
                        <div className="edit-message-actions">
                          <button className="secondary-btn" type="button" onClick={cancelEditMessage}>Cancel</button>
                          <button className="primary-btn" type="button" onClick={() => saveEditedMessage(message)}>Save</button>
                        </div>
                      </div>
                    ) : (
                      message.text ? <p>{message.text}</p> : null
                    )}
                    {message.attachment ? (
                      message.messageType === 'image' ? (
                        <div className="attachment-preview">
                          <img
                            className="message-image"
                            src={message.attachment.data}
                            alt={message.attachment.name}
                            loading="lazy"
                            decoding="async"
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
                    {Array.isArray(message.reactions) && message.reactions.length > 0 ? (
                      <div className="message-reaction-summary" aria-label="Message reactions">
                        {getMessageReactionSummary(message, profile.name).map((reaction) => (
                          <button
                            key={`${message.id || message.clientId || 'message'}-${reaction.emoji}`}
                            type="button"
                            className={`reaction-chip ${reaction.active ? 'active' : ''}`}
                            onClick={() => handleReaction(message, reaction.emoji)}
                          >
                            <span>{reaction.emoji}</span>
                            <small>{reaction.count}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {reactionMenuMessage && (reactionMenuMessage.id === message.id || reactionMenuMessage.clientId === message.clientId) ? (
                      <div className="reaction-picker" role="menu" aria-label="Message reactions">
                        {reactionEmojis.map((emoji) => (
                          <button key={`${message.id || message.clientId || 'reaction'}-${emoji}`} type="button" className="reaction-picker-btn" onClick={() => handleReaction(message, emoji)}>{emoji}</button>
                        ))}
                      </div>
                    ) : null}
                    <div className="status-row">
                      <div className="message-timestamp">
                        {message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        {message.edited ? <span className="edited-badge">Edited</span> : null}
                      </div>
                      {isMine ? (
                        <div className="mine-message-actions">
                          <div
                            className={`message-status ${messageStatus}`}
                            aria-label={messageStatus === 'seen' ? 'Seen by partner' : messageStatus === 'delivered' ? 'Delivered' : messageStatus === 'sending' ? 'Sending' : messageStatus === 'failed' ? 'Message not sent' : 'Sent'}
                            title={messageStatus === 'seen' ? 'Seen by partner' : messageStatus === 'delivered' ? 'Delivered' : messageStatus === 'sending' ? 'Sending' : messageStatus === 'failed' ? 'Message not sent' : 'Sent'}
                          >
                            {messageStatus === 'sending' ? '⟳' : messageStatus === 'failed' ? '!' : messageStatus === 'seen' || messageStatus === 'delivered' ? '✓✓' : '✓'}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {isMine && (activeMessageAction?.id === message.id || activeMessageAction?.clientId === message.clientId) ? (
                      <div className="message-actions-menu" onClick={(event) => event.stopPropagation()}>
                        <button type="button" onClick={(event) => { event.stopPropagation(); beginEditMessage(message) }}>Edit</button>
                        <button type="button" onClick={(event) => { event.stopPropagation(); deleteMessage(message) }}>Delete</button>
                      </div>
                    ) : null}
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
              <img className="preview-image" src={pendingAttachment.attachment.data} alt={pendingAttachment.attachment.name} loading="lazy" decoding="async" />
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
          {isRecording ? (
            <div className={`voice-lock-panel ${voiceRecordLocked ? 'locked' : ''}`} aria-live="polite">
              <div className="voice-lock-hint">
                <span className="recording-dot" />
                <span>{voiceRecordPaused ? 'Paused' : voiceRecordLocked ? 'Locked' : 'Recording'} · {recordingDuration}s</span>
              </div>
              <div className="voice-lock-actions">
                <button type="button" className="voice-lock-btn" onClick={toggleVoicePause}>{voiceRecordPaused ? 'Resume' : 'Pause'}</button>
                <button type="button" className="voice-lock-btn danger" onClick={discardVoiceRecording}>Delete</button>
                <button type="button" className="voice-lock-btn success" onClick={() => stopRecording({ autoSend: true })}>Send</button>
              </div>
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
          <div className={`composer-input-row ${draft.trim() ? 'has-text' : ''}`}>
            <button className="composer-action" type="button" onClick={() => galleryInputRef.current?.click()} aria-label="Attach file">
              <IconUpload />
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

                if (event.metaKey || event.ctrlKey) {
                  event.preventDefault()
                  void sendMessage(event)
                  return
                }

                event.preventDefault()
                const textarea = event.currentTarget
                const start = textarea.selectionStart
                const end = textarea.selectionEnd
                const nextValue = `${draft.slice(0, start)}\n${draft.slice(end)}`
                setDraft(nextValue)
                window.requestAnimationFrame(() => {
                  textarea.selectionStart = start + 1
                  textarea.selectionEnd = start + 1
                  syncMessageInputHeight()
                })
              }}
              onFocus={() => {
                syncMessageInputHeight()
                window.setTimeout(() => {
                  if (!messageListRef.current) {
                    return
                  }

                  const scrollContainer = messageListRef.current
                  const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
                  if (distanceFromBottom < 120) {
                    scrollContainer.scrollTo({
                      top: scrollContainer.scrollHeight,
                      behavior: 'instant',
                    })
                  }
                }, 80)
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
            {draft.trim() ? (
              <button className="composer-send-btn" type="submit" aria-label="Send message"><IconSend /></button>
            ) : (
              <>
                <button className="composer-action" type="button" onClick={() => cameraInputRef.current?.click()} aria-label="Take photo">
                  <IconCamera />
                </button>
                <button
                  className={`composer-action ${isRecording ? 'recording' : ''}`}
                  type="button"
                  onPointerDown={handleVoicePressStart}
                  onPointerMove={handleVoicePressMove}
                  onPointerUp={handleVoicePressEnd}
                  onPointerLeave={handleVoicePressEnd}
                  onPointerCancel={handleVoicePressEnd}
                  aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                >
                  <IconMic />
                </button>
              </>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}

export default App
