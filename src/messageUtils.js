export function sortMessages(messages = []) {
  return [...messages].sort((left, right) => {
    const leftTimestamp = Number(left?.timestamp || left?.createdAt?.toMillis?.() || 0)
    const rightTimestamp = Number(right?.timestamp || right?.createdAt?.toMillis?.() || 0)
    return leftTimestamp - rightTimestamp
  })
}

function shouldPreserveExistingField(key, incomingValue, existingValue, incomingMessage = {}, existingMessage = {}) {
  if (key === 'replyTo') {
    return incomingValue == null && existingValue != null
  }

  if (key === 'status') {
    return (incomingValue == null && existingValue != null)
      || (incomingValue === 'sent' && (existingValue === 'delivered' || existingValue === 'seen'))
  }

  if (key === 'read' || key === 'delivered') {
    return (incomingValue == null && existingValue != null)
      || (incomingValue === false && Boolean(existingValue))
  }

  if (key === 'updatedAt') {
    const incomingTimestamp = Number(incomingMessage?.updatedAt ?? incomingMessage?.timestamp ?? 0)
    const existingTimestamp = Number(existingMessage?.updatedAt ?? existingMessage?.timestamp ?? 0)
    if (Number.isFinite(incomingTimestamp) && Number.isFinite(existingTimestamp) && incomingTimestamp <= existingTimestamp) {
      return true
    }
  }

  if (key === 'reactions') {
    const incomingIsEmpty = Array.isArray(incomingValue) && incomingValue.length === 0
    const existingHasReactions = Array.isArray(existingValue) && existingValue.length > 0
    const incomingTimestamp = Number(incomingMessage?.updatedAt ?? incomingMessage?.timestamp ?? 0)
    const existingTimestamp = Number(existingMessage?.updatedAt ?? existingMessage?.timestamp ?? 0)

    if (incomingIsEmpty && existingHasReactions && Number.isFinite(incomingTimestamp) && Number.isFinite(existingTimestamp) && incomingTimestamp <= existingTimestamp) {
      return true
    }
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
    if (!message || typeof message !== 'object') {
      continue
    }

    const key = buildKey(message)
    const currentIndex = indexByKey.get(key)

    if (typeof currentIndex === 'number') {
      const existingMessage = nextMessages[currentIndex]
      nextMessages[currentIndex] = Object.entries(message).reduce((accumulator, [field, value]) => {
        if (shouldPreserveExistingField(field, value, existingMessage?.[field], message, existingMessage)) {
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

export function mergeRemoteMessageSet(existingMessages = [], incomingMessages = []) {
  const safeIncomingMessages = Array.isArray(incomingMessages) ? incomingMessages.filter((message) => message && typeof message === 'object') : []
  return mergeMessages(existingMessages, safeIncomingMessages)
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

  const matchesTarget = messages.some((existingMessage) => messageMatchesIdentity(existingMessage, [message]))
  if (!matchesTarget) {
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

export function toggleMessageReaction(message = {}, emoji, senderId) {
  if (!message || !emoji || !senderId) {
    return message
  }

  const existingReactions = Array.isArray(message.reactions) ? message.reactions : []
  const alreadyReacted = existingReactions.some((reaction) => reaction?.emoji === emoji && reaction?.senderId === senderId)

  const nextReactions = existingReactions.filter((reaction) => !(reaction?.emoji === emoji && reaction?.senderId === senderId))

  if (!alreadyReacted) {
    nextReactions.push({ emoji, senderId })
  }

  return {
    ...message,
    reactions: nextReactions,
  }
}

export function getMessageReactionSummary(message = {}, currentUserId) {
  const reactions = Array.isArray(message?.reactions) ? message.reactions : []
  const summaryMap = new Map()

  for (const reaction of reactions) {
    const emoji = reaction?.emoji || 'reaction'
    const current = summaryMap.get(emoji) || { emoji, count: 0, active: false }
    current.count += 1
    current.active = current.active || reaction?.senderId === currentUserId
    summaryMap.set(emoji, current)
  }

  return [...summaryMap.values()].sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji))
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

export function isPresenceFresh(presence = {}, now = Date.now(), staleAfterMs = 60000) {
  const lastActive = Number(presence?.lastActive || 0)
  if (!lastActive || !Number.isFinite(lastActive)) {
    return false
  }

  return Boolean(presence?.online) && now - lastActive <= staleAfterMs
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

export async function retryAsync(operation, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? 0))
  const delayMs = Math.max(0, Number(options.delayMs ?? 0))

  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt >= retries) {
        throw error
      }

      if (delayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs))
      }
    }
  }

  throw lastError
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
