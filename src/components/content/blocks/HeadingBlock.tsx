import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { CONTENT } from '../theme'
import type { BlockOf } from '../types'

const LEVEL_STYLES = {
  1: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.4, marginBottom: 18 },
  2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2, marginBottom: 14 },
  3: { fontSize: 16, fontWeight: '600' as const, letterSpacing: 0, marginBottom: 10 },
}

/** Heading block — `level` 1/2/3 maps to descending type scale. */
export function HeadingBlock({ block }: { block: BlockOf<'heading'> }) {
  const level = block.level ?? 2
  return (
    <Text accessibilityRole="header" selectable style={[styles.base, LEVEL_STYLES[level]]}>
      {block.text}
    </Text>
  )
}

const styles = StyleSheet.create({
  base: {
    color: CONTENT.heading,
  },
})
