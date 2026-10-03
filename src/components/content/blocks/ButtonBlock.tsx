import React, { useCallback } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { CONTENT } from '../theme'
import type { BlockOf } from '../types'
import { openExternal } from '../utils'

/** Full-width accent CTA that opens `url`. */
export function ButtonBlock({ block }: { block: BlockOf<'button'> }) {
  const handlePress = useCallback(() => openExternal(block.url), [block.url])

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={block.text}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.label}>{block.text}</Text>
      <Ionicons name="arrow-forward" size={18} color={CONTENT.white} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: CONTENT.accent,
    marginBottom: 16,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  label: {
    color: CONTENT.white,
    fontSize: 15,
    fontWeight: '700',
  },
})
