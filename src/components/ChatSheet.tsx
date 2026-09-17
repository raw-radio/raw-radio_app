import React, { useState, useEffect, useRef, useCallback, useContext } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, Pressable, FlatList, Modal, Image,
  ScrollView, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, useWindowDimensions,
} from 'react-native'
import Animated, {
  Easing as ReanimatedEasing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { storage, STORAGE_KEYS } from '../hooks/useStorage'
import { COLUMN_MAX_WIDTH, ColumnHeightContext, useAppFrame } from '../utils/layout'
import type { ChatMessageDTO } from '../hooks/useChat'

const MAX_TEXT_LENGTH = 200
const MAX_IMAGES = 5
const MAX_IMAGE_SIDE = 600
const MAX_IMAGE_BYTES = 200_000
const NICKNAME_REGEX = /^[\p{L}\p{N} _-]+$/u

/** Chat open/close animation timing. */
const SHEET_OPEN_MS = 260
const SHEET_CLOSE_MS = 200
/** Backdrop dims to 50% black, like `.overlay { background: rgba(0,0,0,0.5) }`. */
const BACKDROP_MAX_OPACITY = 0.5
/** Bottom sheet reaches at most 80% of the window height (web drawer parity). */
const SHEET_MAX_HEIGHT_RATIO = 0.8
/** Desktop cap for the framed web layout — mirrors web `.chat-sheet` `@media (min-width: 768px)`. */
const SHEET_DESKTOP_MAX_HEIGHT = 600

interface SelectedImage {
  uri: string
  name: string
}

/** Prefix relative server paths with the API base; keep absolute URLs as-is. */
function resolveImageUrl(path: string, apiBase: string): string {
  return path.startsWith('http') ? path : `${apiBase}${path}`
}

type NativeFormDataFile = { uri: string; name: string; type: string }

/**
 * Build the value appended to FormData for a single image.
 *
 * On web, React Native's `{ uri, name, type }` object is stringified to
 * `"[object Object]"` — the file must be a real Blob/File. On native,
 * `{ uri, name, type }` is the format React Native's FormData understands.
 */
async function fileFromUri(
  uri: string,
  name: string,
  type: string,
): Promise<File | NativeFormDataFile> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri)
    const blob = await response.blob()
    return new File([blob], name, { type })
  }
  return { uri, name, type }
}

/** Resize (max side 600px) + JPEG-compress an asset, targeting ≤200KB. */
async function compressImage(asset: ImagePicker.ImagePickerAsset): Promise<SelectedImage> {
  const maxSide = Math.max(asset.width, asset.height)
  const scale = maxSide > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / maxSide : 1
  const targetWidth = Math.max(1, Math.round(asset.width * scale))
  const targetHeight = Math.max(1, Math.round(asset.height * scale))
  const actions =
    maxSide > MAX_IMAGE_SIDE
      ? [{ resize: { width: targetWidth, height: targetHeight } }]
      : []

  let compress = 0.7
  let result = await manipulateAsync(asset.uri, actions, {
    compress,
    format: SaveFormat.JPEG,
    base64: true,
  })

  while (
    result.base64 &&
    result.base64.length * 0.75 > MAX_IMAGE_BYTES &&
    compress > 0.3
  ) {
    compress = Math.max(0.3, compress - 0.2)
    result = await manipulateAsync(asset.uri, actions, {
      compress,
      format: SaveFormat.JPEG,
      base64: true,
    })
  }

  const originalName = asset.fileName || `image-${Date.now()}`
  const name = originalName.replace(/\.[^.]+$/, '.jpg')
  return { uri: result.uri, name }
}

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
  const [processing, setProcessing] = useState(false)
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([])
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const flatListRef = useRef<FlatList>(null)
  const API_BASE = process.env.EXPO_PUBLIC_API_URL || ''

  // This sheet lives inside a `Modal` — its own native window — so the root
  // `SafeAreaView` in `app/app/_layout.tsx` (which insets the main content) does
  // NOT reach it. Without this, the Android navigation/gesture bar overlaps the
  // input row. On web `insets.bottom` is 0, so the padding stays as authored.
  const insets = useSafeAreaInsets()

  // One shared progress value (0 = hidden, 1 = fully open) drives both layers:
  // the backdrop only fades, the sheet slides up + fades. `mounted` keeps the
  // Modal around while the closing animation runs.
  const progress = useSharedValue(0)
  const [mounted, setMounted] = useState(isOpen)
  // Reactive window height: rotation / resize recomputes the bound and the
  // closing offset instead of freezing a value captured at first render.
  const { height: windowHeight } = useWindowDimensions()
  const { framed } = useAppFrame()
  // Rendered height of the centred column (null on native / narrow web). RN Web
  // portals `Modal` to `document.body`, so the sheet is not a DOM child of the
  // column even though it should visually belong to it — hence the explicit
  // reference to the column's measured height.
  const columnHeight = useContext(ColumnHeightContext)
  // Bound the sheet by 80% of the viewport (web drawer parity), the rendered
  // column height (so a shorter column always wins), and a 600px desktop cap so
  // it stays phone-sized on a large monitor instead of covering most of it.
  const sheetMaxHeight = Math.min(
    windowHeight * SHEET_MAX_HEIGHT_RATIO,
    columnHeight ?? windowHeight,
    framed ? SHEET_DESKTOP_MAX_HEIGHT : Number.POSITIVE_INFINITY,
  )

  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      progress.value = withTiming(1, {
        duration: SHEET_OPEN_MS,
        easing: ReanimatedEasing.out(ReanimatedEasing.cubic),
      })
      return
    }

    // Closed from the outside (e.g. chat disabled in admin) — hide immediately.
    progress.value = 0
    setMounted(false)
  }, [isOpen, progress])

  const requestClose = useCallback(() => {
    progress.value = withTiming(
      0,
      { duration: SHEET_CLOSE_MS, easing: ReanimatedEasing.in(ReanimatedEasing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(onClose)()
        }
      },
    )
  }, [onClose, progress])

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, BACKDROP_MAX_OPACITY]),
  }))

  const sheetStyle = useAnimatedStyle(
    () => ({
      // Fade lags the slide slightly for the soft "fade-bottom" feel.
      opacity: interpolate(progress.value, [0, 0.3, 1], [0, 0, 1]),
      // The sheet never grows past `sheetMaxHeight`, so this offset is always
      // enough to slide it fully off-screen when closing.
      transform: [{ translateY: interpolate(progress.value, [0, 1], [sheetMaxHeight, 0]) }],
    }),
    [sheetMaxHeight],
  )

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

  const isSendDisabled =
    sending ||
    processing ||
    nickname.trim().length < 2 ||
    (!text.trim() && selectedImages.length === 0)

  const handlePickImages = useCallback(async () => {
    const available = MAX_IMAGES - selectedImages.length
    if (available <= 0 || sending || processing) return

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        setStatusMessage({ type: 'error', message: 'Photo library access is required' })
        return
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: available,
        quality: 1,
      })

      if (result.canceled || result.assets.length === 0) return

      setStatusMessage(null)
      setProcessing(true)

      const next: SelectedImage[] = []
      for (const asset of result.assets.slice(0, available)) {
        next.push(await compressImage(asset))
      }
      setSelectedImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES))
    } catch {
      setStatusMessage({ type: 'error', message: 'Failed to process images' })
    } finally {
      setProcessing(false)
    }
  }, [selectedImages.length, sending, processing])

  const handleRemoveImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (isSendDisabled) return
    const trimmedNickname = nickname.trim()
    const trimmedText = text.trim()
    const hasText = !!trimmedText
    const hasImages = selectedImages.length > 0
    if (!hasText && !hasImages) return

    await storage.setItem(STORAGE_KEYS.CHAT_NICKNAME, trimmedNickname)
    setStatusMessage(null)
    setSending(true)

    try {
      if (hasImages) {
        const formData = new FormData()
        formData.append('nickname', trimmedNickname)
        if (hasText) formData.append('text', trimmedText)
        if (substationSlug) formData.append('substationSlug', substationSlug)
        const files = await Promise.all(
          selectedImages.map((img) => fileFromUri(img.uri, img.name, 'image/jpeg')),
        )
        files.forEach((file) => {
          // Web returns a real File/Blob; native RN FormData needs the plain
          // `{ uri, name, type }` object (hence the cast for the DOM typing).
          formData.append('files', file as unknown as Blob)
        })

        const res = await fetch(`${API_BASE}/api/v1/chat/send-with-images`, {
          method: 'POST',
          body: formData,
        })
        const json = await res.json().catch(() => ({ success: false, error: 'Send error' }))
        if (!res.ok || !json.success) {
          setStatusMessage({
            type: 'error',
            message: res.status === 403 ? 'Chat is currently unavailable' : json.error || 'Send error',
          })
          return
        }
        setSelectedImages([])
        setText('')
        setStatusMessage({ type: 'success', message: 'Sent!' })
        setTimeout(() => setStatusMessage(null), 2000)
      } else {
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
          setStatusMessage({
            type: 'error',
            message: res.status === 403 ? 'Chat is currently unavailable' : json.error || 'Send error',
          })
          return
        }
        setText('')
        setStatusMessage({ type: 'success', message: 'Sent!' })
        setTimeout(() => setStatusMessage(null), 2000)
      }
    } catch {
      setStatusMessage({ type: 'error', message: 'Network error. Try again.' })
    } finally {
      setSending(false)
    }
  }, [nickname, text, substationSlug, sending, isSendDisabled, API_BASE, selectedImages])

  const formatTime = (isoString: string): string => {
    try {
      const d = new Date(isoString)
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    } catch { return '' }
  }

  const renderMessage = useCallback(({ item }: { item: ChatMessageDTO }) => {
    const isOwn = item.nickname === nickname.trim()
    const images = item.images || []
    return (
      <View style={[styles.message, isOwn && styles.messageOwn]}>
        <View style={styles.messageMeta}>
          <Text style={styles.messageNickname}>{item.nickname}</Text>
          <Text style={styles.messageTime}>{formatTime(item.timestamp)}</Text>
        </View>
        <View style={[styles.messageBubble, isOwn && styles.messageBubbleOwn]}>
          {images.length > 0 && (
            <View style={styles.messageImages}>
              {images.map((path, i) => (
                <Image
                  key={`${item.id}-img-${i}`}
                  source={{ uri: resolveImageUrl(path, API_BASE) }}
                  style={styles.messageImage}
                  resizeMode="cover"
                />
              ))}
            </View>
          )}
          {item.text ? <Text style={styles.messageText}>{item.text}</Text> : null}
        </View>
      </View>
    )
  }, [nickname, API_BASE])

  const imagesDisabled = selectedImages.length >= MAX_IMAGES || sending || processing

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent
    >
      <View style={[styles.root, framed && styles.rootFramed]}>
        {/* Backdrop — fades in/out, never slides. */}
        <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть чат"
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[
            framed ? styles.drawerContainerFramed : styles.drawerContainerFull,
            // RN Web portals `Modal` to `document.body`, i.e. outside the
            // framed card. Sizing this box to the measured card height and
            // centring it (`rootFramed`) lines the sheet's bottom edge up with
            // the card's bottom edge, so the sheet sits inside the frame
            // instead of the viewport. Falls back to content height until the
            // card has been measured.
            framed && columnHeight != null ? { height: columnHeight } : null,
          ]}
          pointerEvents="box-none"
        >
          <TouchableWithoutFeedback onPress={() => {}}>
            <Animated.View
              style={[
                styles.drawer,
                framed && styles.drawerFramed,
                { maxHeight: sheetMaxHeight },
                sheetStyle,
              ]}
            >
              <View style={styles.header}>
                <Text style={styles.title}>💬 Chat</Text>
                <TouchableOpacity
                  onPress={requestClose}
                  style={styles.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Закрыть чат"
                >
                  <Ionicons name="close" size={20} color="#aaa" />
                </TouchableOpacity>
              </View>

              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                style={[styles.messagesList, { maxHeight: sheetMaxHeight }]}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>No messages yet. Be the first!</Text>
                  </View>
                }
              />

              {/* Bottom padding carries the device inset on top of the sheet's
                  own 12px, so the input clears the nav bar. Applied to the
                  input area (not the drawer) because they share the background:
                  the fill still reaches the screen edge, only the content lifts. */}
              <View style={[styles.inputArea, { paddingBottom: insets.bottom + 12 }]}>
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
                    onPress={handlePickImages}
                    disabled={imagesDisabled}
                    style={[styles.imageBtn, imagesDisabled && { opacity: 0.5 }]}
                  >
                    {processing ? (
                      <ActivityIndicator size="small" color="#ff6b35" />
                    ) : (
                      <Ionicons name="image-outline" size={20} color="#ff6b35" />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSubmit}
                    disabled={isSendDisabled}
                    style={[styles.sendBtn, isSendDisabled && { opacity: 0.5 }]}
                  >
                    {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>

                {selectedImages.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.previewStrip}
                    contentContainerStyle={styles.previewStripContent}
                  >
                    {selectedImages.map((img, i) => (
                      <View key={`${img.uri}-${i}`} style={styles.previewItem}>
                        <Image source={{ uri: img.uri }} style={styles.previewImage} />
                        <TouchableOpacity onPress={() => handleRemoveImage(i)} style={styles.previewRemove}>
                          <Ionicons name="close" size={12} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}

                {statusMessage && (
                  <Text style={[styles.statusMsg, statusMessage.type === 'error' ? { color: '#ff4444' } : { color: '#2ECC71' }]}>
                    {statusMessage.message}
                  </Text>
                )}
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  // Framed desktop web: the sheet box (card height) is centred so its bottom
  // edge matches the card's bottom edge, not the viewport's.
  rootFramed: { justifyContent: 'center' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
  },
  drawerContainerFull: { flex: 1, justifyContent: 'flex-end' },
  // Framed desktop web: keep the sheet aligned with the centred card it belongs
  // to (the modal portal spans the full viewport width otherwise). The box is
  // content-sized (its height is set from the measured card) — it must not grow
  // to fill the viewport, or the sheet would hang below the card.
  drawerContainerFramed: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    alignSelf: 'center',
    justifyContent: 'flex-end',
  },
  // Height bound is set inline from the live window size (80%); `flexShrink`
  // lets the list shrink inside the sheet so long chats scroll internally.
  drawer: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    // `.chat-sheet { box-shadow: 0 -4px 20px rgba(0,0,0,.5) }` — upward shadow
    // onto the dimmed backdrop. Web: exact CSS string. Native: iOS honours the
    // negative offset; Android `elevation` only casts downward, so the Android
    // approximation gives depth without the top glow.
    ...Platform.select({
      web: { boxShadow: '0 -4px 20px rgba(0,0,0,0.5)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 12,
      },
    }),
  },
  drawerFramed: { width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#222' },
  title: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  closeBtn: { padding: 4 },
  messagesList: { flexShrink: 1, paddingHorizontal: 16 },
  message: { marginTop: 12 },
  messageOwn: { alignItems: 'flex-end' },
  messageMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  messageNickname: { color: '#888', fontSize: 12, fontWeight: '600' },
  messageTime: { color: '#666', fontSize: 11, marginLeft: 8 },
  messageBubble: { backgroundColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '85%' },
  messageBubbleOwn: { backgroundColor: '#ff6b35' },
  messageText: { color: '#fff', fontSize: 14 },
  messageImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  messageImage: { width: 120, height: 120, borderRadius: 8, backgroundColor: '#111' },
  emptyState: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 14 },
  // `paddingBottom` is set inline (`insets.bottom + 12`) — see the input area.
  inputArea: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#222' },
  nicknameInput: { backgroundColor: '#222', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 14, marginBottom: 8 },
  inputError: { borderWidth: 1, borderColor: '#ff4444' },
  fieldError: { color: '#ff4444', fontSize: 12, marginBottom: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  textInput: { flex: 1, backgroundColor: '#222', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 14, maxHeight: 80 },
  charCounter: { color: '#666', fontSize: 11, marginHorizontal: 8, marginBottom: 10 },
  imageBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 2, marginRight: 4 },
  sendBtn: { backgroundColor: '#ff6b35', borderRadius: 20, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  previewStrip: { marginTop: 8, maxHeight: 72 },
  previewStripContent: { gap: 8 },
  previewItem: { width: 64, height: 64, borderRadius: 8, overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  previewRemove: { position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  statusMsg: { fontSize: 12, marginTop: 6, textAlign: 'center' },
})
