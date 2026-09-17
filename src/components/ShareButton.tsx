import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

const FEEDBACK_MS = 2000

interface ShareButtonProps {
  slug: string
}

export function ShareButton({ slug }: ShareButtonProps) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    },
    [],
  )

  const showFeedback = useCallback((message: string) => {
    setFeedback(message)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS)
  }, [])

  const handleShare = useCallback(async () => {
    const base = process.env.EXPO_PUBLIC_API_URL || ''
    const streamUrl = `${base}/${slug}.mp3`
    const message = `Listen to RAW Radio: ${streamUrl}`

    if (Platform.OS === 'web') {
      // `react-native-web` does NOT implement RN's `Share`. Prefer the Web Share
      // API and fall back to copying the stream URL to the clipboard.
      const nav = typeof navigator !== 'undefined' ? navigator : undefined
      if (nav?.share) {
        try {
          await nav.share({ title: 'RAW Radio', text: message, url: streamUrl })
        } catch {
          // Share sheet dismissed — nothing to do.
        }
        return
      }
      try {
        await nav?.clipboard?.writeText(streamUrl)
        showFeedback('Ссылка скопирована')
      } catch {
        showFeedback('Не удалось скопировать')
      }
      return
    }

    try {
      await Share.share({
        message,
        title: 'RAW Radio',
        url: Platform.OS === 'ios' ? streamUrl : undefined,
      })
    } catch {
      // Share sheet was dismissed / is unavailable on this platform — nothing to do.
    }
  }, [slug, showFeedback])

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={handleShare}
        style={styles.button}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Share stream"
      >
        <Ionicons name="share-social" size={18} color="#b3b3b3" />
      </TouchableOpacity>
      {feedback && (
        <Text style={styles.feedback} numberOfLines={1} accessibilityLiveRegion="polite">
          {feedback}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  // Matches `.header-btn` in player.scss: 40×40 hit area, 8px radius.
  button: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Small inline confirmation shown on web after a clipboard copy.
  feedback: {
    position: 'absolute',
    top: 42,
    right: 0,
    width: 130,
    textAlign: 'right',
    color: '#ff6b35',
    fontSize: 11,
  },
})
