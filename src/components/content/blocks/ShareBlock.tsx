import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { CONTENT } from '../theme'
import type { BlockOf } from '../types'
import { copyToClipboard } from '../utils'

const FEEDBACK_MS = 2000

/**
 * Share CTA. Mirrors the platform split used by `ShareButton`: Web Share API
 * (falling back to a clipboard copy) on web, RN `Share` on native. Inline
 * feedback replaces a toast so the block stays self-contained.
 */
export function ShareBlock({ block }: { block: BlockOf<'share'> }) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const showFeedback = useCallback((message: string) => {
    setFeedback(message)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS)
  }, [])

  const handleShare = useCallback(async () => {
    const text = block.text || 'RAW Radio'
    const url = block.url || ''
    const message = url && !text.includes(url) ? `${text} ${url}` : text

    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? navigator : undefined
      if (nav?.share) {
        try {
          await nav.share({ title: 'RAW Radio', text, url: url || undefined })
        } catch {
          // Share sheet dismissed — nothing to do.
        }
        return
      }
      const copied = await copyToClipboard(url || text)
      showFeedback(copied ? 'Ссылка скопирована' : 'Не удалось скопировать')
      return
    }

    try {
      await Share.share({
        message,
        title: 'RAW Radio',
        url: Platform.OS === 'ios' && url ? url : undefined,
      })
    } catch {
      // Share sheet dismissed / unavailable — nothing to do.
    }
  }, [block.text, block.url, showFeedback])

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={handleShare}
        accessibilityRole="button"
        accessibilityLabel={block.text || 'Поделиться'}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Ionicons name="share-social-outline" size={18} color={CONTENT.accent} />
        <Text style={styles.label}>{block.text || 'Поделиться'}</Text>
      </Pressable>
      {feedback && (
        <Text style={styles.feedback} accessibilityLiveRegion="polite">
          {feedback}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CONTENT.accentBorder,
    backgroundColor: CONTENT.accentSoft,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  label: {
    color: CONTENT.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  feedback: {
    color: CONTENT.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
})
