import { useEffect, useState, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'

const SOCKET_URL = process.env.EXPO_PUBLIC_WS_URL || ''
const API_BASE = process.env.EXPO_PUBLIC_API_URL || ''

export interface ChatMessageDTO {
  id: string
  nickname: string
  text: string
  timestamp: string
  substationSlug?: string
  images?: string[]
}

interface ChatSettingsDTO {
  isOpen: boolean
  showLiveLabel: boolean
  liveLabelText?: string | null
  substationSlug?: string
}

export function useChat(slug: string) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [messages, setMessages] = useState<ChatMessageDTO[]>([])
  const [showLiveLabel, setShowLiveLabel] = useState(false)
  const [liveLabelText, setLiveLabelText] = useState<string | null>(null)
  const slugRef = useRef(slug)
  slugRef.current = slug

  useEffect(() => {
    setIsLoading(true)
    setShowLiveLabel(false)
    setLiveLabelText(null)

    fetch(`${API_BASE}/api/v1/chat/settings?substationSlug=${slug}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data?.data) {
          setIsOpen(data.data.isOpen === true)
          setShowLiveLabel(data.data.showLiveLabel === true)
          setLiveLabelText(data.data.liveLabelText ?? null)
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [slug])

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    })

    const handleChatStatus = (dto: ChatSettingsDTO) => {
      if (dto.substationSlug === slugRef.current) {
        setIsOpen(dto.isOpen)
        setShowLiveLabel(dto.showLiveLabel === true)
        setLiveLabelText(dto.liveLabelText ?? null)
      }
    }

    const handleChatMessage = (msg: ChatMessageDTO) => {
      if (msg.substationSlug === slugRef.current) {
        setMessages((prev) => [...prev, msg])
      }
    }

    socket.on('chat:status', handleChatStatus)
    socket.on('chat:message', handleChatMessage)

    return () => {
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    setMessages([])
  }, [slug])

  useEffect(() => {
    if (!isOpen) {
      setMessages([])
      return
    }

    fetch(`${API_BASE}/api/v1/chat/messages?substationSlug=${slug}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.data)) {
          setMessages((prev) => {
            const serverIds = new Set(data.data.map((m: ChatMessageDTO) => m.id))
            const extra = prev.filter((m) => !serverIds.has(m.id))
            return [...data.data, ...extra]
          })
        }
      })
      .catch(() => {})
  }, [isOpen, slug])

  return { isOpen, isLoading, messages, showLiveLabel, liveLabelText }
}
