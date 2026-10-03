import React, { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { APP_SURFACE_BG_RAISED } from '../utils/layout'

const ENTER_MS = 260
const SLIDE_FROM = 10

const ACCENT = '#ff6b35'
const ACCENT_SOFT = 'rgba(255, 107, 53, 0.14)'
const ACCENT_BORDER = 'rgba(255, 107, 53, 0.3)'

interface ClientCtaBannerProps {
  label: string
  onPress: () => void
  /** Ionicons glyph name; defaults to `heart`. */
  icon?: string
}

/**
 * Raised promo CTA shown above the play button — a slim full-width row
 * (inset 16px) with an accent hairline border. It is deliberately *not* a
 * gradient/filled button so it never competes with the play control for
 * attention; only the border, icon tint and chevron carry the accent.
 *
 * Entrance is a fade + slight rise (Reanimated, UI thread). Under the OS
 * "reduce motion" preference the card appears instantly.
 */
export function ClientCtaBanner({ label, onPress, icon }: ClientCtaBannerProps) {
  const reducedMotion = useReducedMotion()
  const progress = useSharedValue(reducedMotion ? 1 : 0)

  useEffect(() => {
    if (reducedMotion) {
      progress.value = 1
      return
    }
    progress.value = withTiming(1, {
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
    })
  }, [reducedMotion, progress])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [SLIDE_FROM, 0]) }],
  }))

  return (
    <Animated.View style={[styles.root, animatedStyle]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.iconBadge}>
          <Ionicons
            name={(icon ?? 'heart') as keyof typeof Ionicons.glyphMap}
            size={18}
            color={ACCENT}
          />
        </View>

        <Text style={styles.label} numberOfLines={2} ellipsizeMode="tail">
          {label}
        </Text>

        <Ionicons name="chevron-forward" size={18} color={ACCENT} />
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: APP_SURFACE_BG_RAISED,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT_SOFT,
  },
  label: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
})
