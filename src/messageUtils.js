export function sortMessages(messages = []) {
  return [...messages].sort((left, right) => {
    const leftTimestamp = Number(left?.timestamp || left?.createdAt?.toMillis?.() || 0)
    const rightTimestamp = Number(right?.timestamp || right?.createdAt?.toMillis?.() || 0)
    return leftTimestamp - rightTimestamp
  })
}

function shouldPreserveExistingField(key, incomingValue, existingValue) {
  if (key === 'replyTo') {
    return incomingValue == null && existingValue != null
  }

  if (key === 'status') {
    return incomingValue === 'sent' && (existingValue === 'delivered' || existingValue === 'seen')
  }

  if (key === 'read' || key === 'delivered') {
    return incomingValue === false && Boolean(existingValue)
  }

  return false
}

export function mergeMessages(existingMessages = [], incomingMessages = []) {
  const nextMessages = []
  const indexByKey = new Map()

  const buildKey = (message) => {
    if (!message) {
      return 'empty'
    }

    const clientId = message.clientId || message.localId || message.tempId
    if (clientId) {
      return `client:${clientId}`
    }

    return message?.id || `${message?.senderId || 'unknown'}-${message?.text || ''}-${message?.timestamp || message?.createdAt || ''}`
  }

  for (const message of [...existingMessages, ...incomingMessages]) {
    const key = buildKey(message)
    const currentIndex = indexByKey.get(key)

    if (typeof currentIndex === 'number') {
      const existingMessage = nextMessages[currentIndex]
      nextMessages[currentIndex] = Object.entries(message).reduce((accumulator, [field, value]) => {
        if (shouldPreserveExistingField(field, value, existingMessage?.[field])) {
          accumulator[field] = existingMessage[field]
          return accumulator
        }

        accumulator[field] = value
        return accumulator
      }, { ...existingMessage })
      continue
    }

    indexByKey.set(key, nextMessages.length)
    nextMessages.push(message)
  }

  return sortMessages(nextMessages)
}

function buildMessageIdentitySet(messageIds = []) {
  return new Set((Array.isArray(messageIds) ? messageIds : []).flatMap((messageId) => {
    if (typeof messageId === 'string') {
      return [messageId]
    }

    return [messageId?.id, messageId?.clientId, messageId?.localId, messageId?.tempId].filter(Boolean)
  }))
}

function messageMatchesIdentity(message = {}, messageIds = []) {
  if (!Array.isArray(messageIds) || !messageIds.length) {
    return false
  }

  const nextMessageIds = buildMessageIdentitySet(messageIds)
  return nextMessageIds.has(message?.id)
    || nextMessageIds.has(message?.clientId)
    || nextMessageIds.has(message?.localId)
    || nextMessageIds.has(message?.tempId)
}

export function updateMessageByIdentity(messages = [], message = {}, updates = {}) {
  if (!message || !Array.isArray(messages)) {
    return messages
  }

  return messages.map((existingMessage) => {
    if (!messageMatchesIdentity(existingMessage, [message])) {
      return existingMessage
    }

    return {
      ...existingMessage,
      ...updates,
    }
  })
}

export function removeMessagesByIdentity(messages = [], messageIds = []) {
  if (!Array.isArray(messages)) {
    return []
  }

  return messages.filter((message) => !messageMatchesIdentity(message, messageIds))
}

export function applyDeliveredReceipts(messages = [], messageIds = []) {
  if (!Array.isArray(messageIds) || !messageIds.length) {
    return messages
  }

  return messages.map((message) => {
    if (!messageMatchesIdentity(message, messageIds)) {
      return message
    }

    return {
      ...message,
      delivered: true,
      read: false,
      status: 'delivered',
    }
  })
}

export function applyReadReceipts(messages = [], messageIds = []) {
  if (!Array.isArray(messageIds) || !messageIds.length) {
    return messages
  }

  const nextMessageIds = new Set(messageIds)
  return messages.map((message) => {
    const matchesReceipt = nextMessageIds.has(message?.id)
      || nextMessageIds.has(message?.clientId)
      || nextMessageIds.has(message?.localId)
      || nextMessageIds.has(message?.tempId)

    if (!matchesReceipt) {
      return message
    }

    return {
      ...message,
      read: true,
      delivered: true,
      status: 'seen',
    }
  })
}

export function getMessageStatus(message = {}) {
  if (message?.status === 'sending') {
    return 'sending'
  }

  if (message?.status === 'failed') {
    return 'failed'
  }

  if (message?.read || message?.status === 'seen') {
    return 'seen'
  }

  if (message?.delivered || message?.status === 'delivered') {
    return 'delivered'
  }

  return 'sent'
}

function getAttachmentStoreKey(roomId) {
  return `m3ssaging-attachments:${roomId}`
}

function readAttachmentStore(storage, roomId) {
  if (!storage) {
    return {}
  }

  try {
    const stored = storage.getItem(getAttachmentStoreKey(roomId))
    if (!stored) {
      return {}
    }

    const parsed = JSON.parse(stored)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAttachmentStore(storage, roomId, attachments) {
  if (!storage) {
    return false
  }

  try {
    storage.setItem(getAttachmentStoreKey(roomId), JSON.stringify(attachments))
    return true
  } catch {
    return false
  }
}

export function hydrateMessagesWithAttachments(roomId, messages = [], storage = window?.localStorage) {
  if (!roomId || !Array.isArray(messages)) {
    return messages
  }

  const attachments = readAttachmentStore(storage, roomId)
  return messages.map((message) => {
    if (!message || typeof message !== 'object' || !message.attachment || typeof message.attachment !== 'object') {
      return message
    }

    const nextAttachment = { ...message.attachment }
    const attachmentId = nextAttachment.attachmentId || nextAttachment.id
    const storedData = attachmentId ? attachments[attachmentId] : null

    if (!nextAttachment.data && storedData) {
      nextAttachment.data = storedData
    }

    return {
      ...message,
      attachment: nextAttachment,
    }
  })
}

export function persistMessages(roomId, messages = [], storage = window?.localStorage) {
  if (!roomId || !Array.isArray(messages)) {
    return false
  }

  const attachments = readAttachmentStore(storage, roomId)
  const normalizedMessages = messages.map((message) => {
    if (!message || typeof message !== 'object') {
      return message
    }

    const nextMessage = { ...message }
    if (!nextMessage.attachment || typeof nextMessage.attachment !== 'object') {
      return nextMessage
    }

    const nextAttachment = { ...nextMessage.attachment }
    const attachmentId = nextAttachment.attachmentId || nextAttachment.id || `${nextMessage.id || nextMessage.clientId || 'attachment'}-${Date.now()}`

    if (typeof nextAttachment.data === 'string' && nextAttachment.data.length > 160000) {
      attachments[attachmentId] = nextAttachment.data
      nextAttachment.data = ''
      nextAttachment.attachmentId = attachmentId
    } else {
      nextAttachment.attachmentId = attachmentId
    }

    nextMessage.attachment = nextAttachment
    return nextMessage
  })

  const payload = JSON.stringify(normalizedMessages)

  if (!storage) {
    return false
  }

  try {
    storage.setItem(`m3ssaging-messages:${roomId}`, payload)
    writeAttachmentStore(storage, roomId, attachments)
    return true
  } catch {
    return false
  }
}
