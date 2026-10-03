import React from 'react'
import { Image, Platform, StyleSheet, Text, View } from 'react-native'
import { CONTENT } from '../theme'
import { resolveImageUrl } from '../utils'
import type { BlockOf } from '../types'

/**
 * Responsive promo image with an optional caption. `contain` avoids cropping
 * photos of unknown aspect ratio; the 16:9 frame keeps the column rhythm stable.
 */
export function ImageBlock({ block }: { block: BlockOf<'image'> }) {
  // `alt` is a react-native-web-only prop; RN types don't declare it, so it is
  // spread conditionally and only on web.
  const webAltProps = Platform.OS === 'web' && block.alt ? { alt: block.alt } : undefined

  return (
    <View style={styles.wrap}>
      <Image
        source={{ uri: resolveImageUrl(block.url) }}
        style={styles.image}
        resizeMode="contain"
        accessible={!!block.alt}
        accessibilityLabel={block.alt}
        {...webAltProps}
      />
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
    marginBottom: 16,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: CONTENT.panel,
  },
  caption: {
    color: CONTENT.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },
})
