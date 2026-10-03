import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { CONTENT } from '../theme'
import type { BlockOf } from '../types'

/** Body-copy block. Selectable so users can copy addresses / instructions. */
export function ParagraphBlock({ block }: { block: BlockOf<'paragraph'> }) {
  return (
    <Text selectable style={styles.text}>
      {block.text}
    </Text>
  )
}

const styles = StyleSheet.create({
  text: {
    color: CONTENT.text,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 16,
  },
})
