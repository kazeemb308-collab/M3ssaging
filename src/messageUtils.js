export function sortMessages(messages = []) {
  return [...messages].sort((left, right) => {
    const leftTimestamp = Number(left?.timestamp || left?.createdAt?.toMillis?.() || 0)
    const rightTimestamp = Number(right?.timestamp || right?.createdAt?.toMillis?.() || 0)
    return leftTimestamp - rightTimestamp
  })
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
      nextMessages[currentIndex] = {
        ...nextMessages[currentIndex],
        ...message,
      }
      continue
    }

    indexByKey.set(key, nextMessages.length)
    nextMessages.push(message)
  }

  return sortMessages(nextMessages)
}

export function applyReadReceipts(messages = [], messageIds = []) {
  if (!Array.isArray(messageIds) || !messageIds.length) {
    return messages
  }

  const nextMessageIds = new Set(messageIds)
  return messages.map((message) => {
    if (!nextMessageIds.has(message?.id)) {
      return message
    }

    return { ...message, read: true }
  })
}
