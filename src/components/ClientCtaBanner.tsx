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
import { APP_SURFACE_BG_RAISED, SURFACE_BORDER_WIDTH, SURFACE_RADIUS } from '../utils/layout'

const ENTER_MS = 260
const SLIDE_FROM = 10

/**
 * One multiplier drives every BOX metric of the CTA (height, paddings, badge,
 * gaps, glyph and label sizes), so the whole control can be resized from a
 * single number. Corner radius and border width are deliberately NOT scaled —
 * they stay pinned to the shared `SURFACE_RADIUS` / `SURFACE_BORDER_WIDTH` so
 * the CTA keeps the same geometry as the station cards and the APK button.
 * `scaled()` rounds each metric to whole px to avoid sub-pixel rendering on
 * small screens.
 */
const CTA_SCALE = 1.2
const scaled = (value: number) => Math.round(value * CTA_SCALE)

const CTA_MIN_HEIGHT = scaled(52) // 62
const CTA_PADDING_HORIZONTAL = scaled(14) // 17
const CTA_PADDING_VERTICAL = scaled(12) // 14
const CTA_GAP = scaled(12) // 14
const CTA_ICON_SIZE = scaled(18) // 22 (badge glyph + chevron)
const CTA_ICON_BADGE_SIZE = scaled(32) // 38
const CTA_ICON_BADGE_RADIUS = scaled(10) // 12
const CTA_LABEL_FONT_SIZE = scaled(14) // 17
const CTA_LABEL_LINE_HEIGHT = scaled(20) // 24

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
            size={CTA_ICON_SIZE}
            color={ACCENT}
          />
        </View>

        <Text style={styles.label} numberOfLines={2} ellipsizeMode="tail">
          {label}
        </Text>

        <Ionicons name="chevron-forward" size={CTA_ICON_SIZE} color={ACCENT} />
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
    gap: CTA_GAP,
    minHeight: CTA_MIN_HEIGHT,
    paddingHorizontal: CTA_PADDING_HORIZONTAL,
    paddingVertical: CTA_PADDING_VERTICAL,
    // Shared surface geometry (see `utils/layout`) — matches the station cards
    // and the APK button. Radius/border are intentionally fixed to the shared
    // constants and NOT run through `CTA_SCALE`: only the box grows, the
    // geometry stays in step with the rest of the surfaces.
    borderRadius: SURFACE_RADIUS,
    backgroundColor: APP_SURFACE_BG_RAISED,
    borderWidth: SURFACE_BORDER_WIDTH,
    borderColor: ACCENT_BORDER,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  iconBadge: {
    width: CTA_ICON_BADGE_SIZE,
    height: CTA_ICON_BADGE_SIZE,
    borderRadius: CTA_ICON_BADGE_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT_SOFT,
  },
  label: {
    flex: 1,
    color: '#fff',
    fontSize: CTA_LABEL_FONT_SIZE,
    lineHeight: CTA_LABEL_LINE_HEIGHT,
    fontWeight: '600',
  },
})
