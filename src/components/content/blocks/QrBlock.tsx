import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { CONTENT } from '../theme'
import type { BlockOf } from '../types'

const DEFAULT_SIZE = 200
const MIN_SIZE = 96
const MAX_SIZE = 320

/**
 * Standalone QR block. Rendered on a white tile so the quiet zone survives on
 * the dark page and scanners keep a high-contrast target. `react-native-svg`
 * (already a dependency) is the native renderer underneath.
 */
export function QrBlock({ block }: { block: BlockOf<'qr'> }) {
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, block.size ?? DEFAULT_SIZE))

  // An empty value is not scannable and makes the encoder throw — skip it.
  if (!block.value) return null

  return (
    <View style={styles.wrap}>
      <View style={styles.tile}>
        <QRCode value={block.value} size={size} backgroundColor="#fff" color={CONTENT.qrOnWhite} />
      </View>
      {!!block.caption && (
        <Text selectable style={styles.caption}>
          {block.caption}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginBottom: 16,
  },
  tile: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  caption: {
    color: CONTENT.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },
})
