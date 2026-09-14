import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Modal,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { storage, STORAGE_KEYS } from '../hooks/useStorage'
import type { ChatMessageDTO } from '../hooks/useChat'

const MAX_TEXT_LENGTH = 200
const NICKNAME_REGEX = /^[\p{L}\p{N} _-]+$/u

interface ChatSheetProps {
  isOpen: boolean
  onClose: () => void
  substationSlug?: string
  messages: ChatMessageDTO[]
}

export function ChatSheet({ isOpen, onClose, substationSlug, messages }: ChatSheetProps) {
  const [nickname, setNickname] = useState('')
  const [nicknameError, setNicknameError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const flatListRef = useRef<FlatList>(null)
  const API_BASE = process.env.EXPO_PUBLIC_API_URL || ''

  useEffect(() => {
    storage.getItem(STORAGE_KEYS.CHAT_NICKNAME).then((saved) => {
      if (saved) setNickname(saved)
    })
  }, [])

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [messages.length])

  const handleNicknameChange = useCallback((value: string) => {
    setNicknameError(null)
    if (value.length > 0 && !NICKNAME_REGEX.test(value)) {
      setNicknameError('Letters, digits, space, _ and - only')
      return
    }
    setNickname(value)
  }, [])

  const isSendDisabled = sending || nickname.trim().length < 2 || !text.trim()

  const handleSubmit = useCallback(async () => {
    if (isSendDisabled) return
    const trimmedNickname = nickname.trim()
    const trimmedText = text.trim()
    if (!trimmedText) return

    await storage.setItem(STORAGE_KEYS.CHAT_NICKNAME, trimmedNickname)
    setStatusMessage(null)
    setSending(true)

    try {
      const res = await fetch(`${API_BASE}/api/v1/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: trimmedNickname,
          text: trimmedText,
          substationSlug: substationSlug || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setStatusMessage({ type: 'error', message: json.error || 'Send error' })
        return
      }
      setText('')
      setStatusMessage({ type: 'success', message: 'Sent!' })
      setTimeout(() => setStatusMessage(null), 2000)
    } catch {
      setStatusMessage({ type: 'error', message: 'Network error. Try again.' })
    } finally {
      setSending(false)
    }
  }, [nickname, text, substationSlug, sending, isSendDisabled, API_BASE])

  const formatTime = (isoString: string): string => {
    try {
      const d = new Date(isoString)
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    } catch { return '' }
  }

  const renderMessage = useCallback(({ item }: { item: ChatMessageDTO }) => {
    const isOwn = item.nickname === nickname.trim()
    return (
      <View style={[styles.message, isOwn && styles.messageOwn]}>
        <View style={styles.messageMeta}>
          <Text style={styles.messageNickname}>{item.nickname}</Text>
          <Text style={styles.messageTime}>{formatTime(item.timestamp)}</Text>
        </View>
        <View style={[styles.messageBubble, isOwn && styles.messageBubbleOwn]}>
          <Text style={styles.messageText}>{item.text}</Text>
        </View>
      </View>
    )
  }, [nickname])

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.drawer}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.title}>💬 Chat</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#aaa" />
              </TouchableOpacity>
            </View>

            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              style={styles.messagesList}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No messages yet. Be the first!</Text>
                </View>
              }
            />

            <View style={styles.inputArea}>
              <TextInput
                style={[styles.nicknameInput, nicknameError && styles.inputError]}
                placeholder="Your name"
                placeholderTextColor="#666"
                value={nickname}
                onChangeText={handleNicknameChange}
                maxLength={30}
                autoCorrect={false}
              />
              {nicknameError && <Text style={styles.fieldError}>{nicknameError}</Text>}

              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Message..."
                  placeholderTextColor="#666"
                  value={text}
                  onChangeText={setText}
                  maxLength={MAX_TEXT_LENGTH}
                  multiline
                  editable={!sending}
                />
                <Text style={styles.charCounter}>{text.length}/{MAX_TEXT_LENGTH}</Text>
                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={isSendDisabled}
                  style={[styles.sendBtn, isSendDisabled && { opacity: 0.5 }]}
                >
                  {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
                </TouchableOpacity>
              </View>

              {statusMessage && (
                <Text style={[styles.statusMsg, statusMessage.type === 'error' ? { color: '#ff4444' } : { color: '#2ECC71' }]}>
                  {statusMessage.message}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  drawer: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#222' },
  title: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  closeBtn: { padding: 4 },
  messagesList: { maxHeight: 300, paddingHorizontal: 16 },
  message: { marginTop: 12 },
  messageOwn: { alignItems: 'flex-end' },
  messageMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  messageNickname: { color: '#888', fontSize: 12, fontWeight: '600' },
  messageTime: { color: '#666', fontSize: 11, marginLeft: 8 },
  messageBubble: { backgroundColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '85%' },
  messageBubbleOwn: { backgroundColor: '#ff6b35' },
  messageText: { color: '#fff', fontSize: 14 },
  emptyState: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 14 },
  inputArea: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#222' },
  nicknameInput: { backgroundColor: '#222', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 14, marginBottom: 8 },
  inputError: { borderWidth: 1, borderColor: '#ff4444' },
  fieldError: { color: '#ff4444', fontSize: 12, marginBottom: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  textInput: { flex: 1, backgroundColor: '#222', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 14, maxHeight: 80 },
  charCounter: { color: '#666', fontSize: 11, marginHorizontal: 8, marginBottom: 10 },
  sendBtn: { backgroundColor: '#ff6b35', borderRadius: 20, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statusMsg: { fontSize: 12, marginTop: 6, textAlign: 'center' },
})
