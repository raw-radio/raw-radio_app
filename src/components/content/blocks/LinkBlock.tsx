import React, { useCallback } from 'react'
import { StyleSheet, Text } from 'react-native'
import { CONTENT } from '../theme'
import type { BlockOf } from '../types'
import { openExternal } from '../utils'

/** Inline accent link that opens in a new tab / the OS browser. */
export function LinkBlock({ block }: { block: BlockOf<'link'> }) {
  const handlePress = useCallback(() => openExternal(block.url), [block.url])

  return (
    <Text
      selectable
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={block.text}
      style={styles.link}
    >
      {block.text}
    </Text>
  )
}

const styles = StyleSheet.create({
  link: {
    color: CONTENT.accent,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 24,
    marginBottom: 16,
  },
})
