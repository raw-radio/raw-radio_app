import React, { useCallback } from 'react'
import { TouchableOpacity, Share, StyleSheet, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

interface ShareButtonProps {
  slug: string
}

export function ShareButton({ slug }: ShareButtonProps) {
  const handleShare = useCallback(async () => {
    const base = process.env.EXPO_PUBLIC_API_URL || ''
    const streamUrl = `${base}/${slug}.mp3`
    try {
      await Share.share({
        message: `Listen to RAW Radio: ${streamUrl}`,
        title: 'RAW Radio',
        url: Platform.OS === 'ios' ? streamUrl : undefined,
      })
    } catch {}
  }, [slug])

  return (
    <TouchableOpacity onPress={handleShare} style={styles.button} accessibilityLabel="Share stream">
      <Ionicons name="share-social" size={20} color="#aaa" />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: { padding: 12 },
})
