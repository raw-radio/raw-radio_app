import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native'
import type { SubstationInfo } from '../hooks/useSubstations'
import { SubstationIcon } from './SubstationIcon'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { SURFACE_BORDER_WIDTH, SURFACE_RADIUS } from '../utils/layout'

/**
 * Station cards are intentionally large: the row is the primary way to switch
 * a stream on a phone, so each card is a big tap target. `CARD_SCALE` multiplies
 * the box metrics (icon, padding, gaps) so the row can be tuned from one number;
 * the name's type size is tuned separately (below) rather than scaled.
 */
const CARD_SCALE = 2
const CARD_ICON_SIZE = 32 * CARD_SCALE // 64
const CARD_PADDING_VERTICAL = 12 * CARD_SCALE // 24
const CARD_PADDING_HORIZONTAL = 14 * CARD_SCALE // 28
const CARD_GAP = 6 * CARD_SCALE // 12 (icon ↔ name, inside a card)
// Matched to the player's track title (18px) so the station name and the
// now-playing line read as the same type scale — deliberately NOT `11 * CARD_SCALE`
// (a ×2 label overpowered the icon). Line-height keeps the ~1.2 ratio.
const CARD_NAME_FONT_SIZE = 18
const CARD_NAME_LINE_HEIGHT = 22
const CARD_LIST_GAP = 8 * CARD_SCALE // 16 (between cards)
/**
 * The card is at least a square: `minHeight` is the row's target height, and
 * `minWidth` keeps short-named stations from collapsing into a skinny sliver.
 * The width is allowed to grow with the name — very long names make a wide card
 * on purpose (centring then clamps to the content edge, see `attemptCenter`).
 */
const CARD_MIN_SIZE = 150
const CARD_INDICATOR_FONT_SIZE = 12
/** Keeps the ● clear of the shared 12px corner radius. */
const CARD_INDICATOR_OFFSET = SURFACE_RADIUS

const ICON_RESTING_COLOR = '#FFFFF0'

interface Props {
  substations: SubstationInfo[]
  currentSlug: string
  onSelect: (slug: string) => void
}

interface SubstationCardProps {
  substation: SubstationInfo
  isActive: boolean
  onSelect: (slug: string) => void
  onMeasure: (slug: string, layout: { x: number; width: number }) => void
}

function SubstationCard({ substation, isActive, onSelect, onMeasure }: SubstationCardProps) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout
      onMeasure(substation.slug, { x, width })
    },
    [onMeasure, substation.slug],
  )

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isActive && styles.cardActive,
        { borderColor: isActive ? substation.color : 'rgba(255, 255, 255, 0.1)' },
      ]}
      onLayout={handleLayout}
      onPress={() => onSelect(substation.slug)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={substation.name}
      accessibilityState={{ selected: isActive }}
    >
      <SubstationIcon
        name={substation.icon}
        size={CARD_ICON_SIZE}
        color={isActive ? substation.color : ICON_RESTING_COLOR}
      />
      <Text style={styles.name} numberOfLines={1}>
        {substation.name}
      </Text>
      {isActive && <Text style={[styles.indicator, { color: substation.color }]}>●</Text>}
    </TouchableOpacity>
  )
}

export function SubstationSelector({ substations, currentSlug, onSelect }: Props) {
  const reducedMotion = useReducedMotion()
  const scrollRef = useRef<ScrollView>(null)

  /** Real measured geometry, keyed by slug — the card width is variable. */
  const cardLayoutsRef = useRef<Map<string, { x: number; width: number }>>(new Map())
  const viewportWidthRef = useRef(0)
  const contentWidthRef = useRef(0)
  /** Last scroll offset we asked for, to break the onLayout → scrollTo loop. */
  const appliedXRef = useRef(0)
  /** Slug whose card should sit centred (tap or programmatic switch). */
  const desiredSlugRef = useRef(currentSlug)
  /**
   * Set only from a user tap: `true` makes the *next* centre scroll animated.
   * Everything else (first layout, cold start, remount, notification prev/next)
   * leaves it `false` and snaps instantly. Consumed once per scroll.
   */
  const animateNextRef = useRef(false)

  /**
   * Mirror of the reduce-motion preference, read by `attemptCenter`. Synced
   * after commit (never written during render), so `attemptCenter` can stay
   * referentially stable and the layout callbacks can call it directly instead
   * of through a per-render ref bridge.
   */
  const reducedMotionRef = useRef(reducedMotion)
  useLayoutEffect(() => {
    reducedMotionRef.current = reducedMotion
  }, [reducedMotion])

  /**
   * Scrolls the active card's centre to the viewport centre, clamped so edge
   * cards stop at the content edge instead of centring (there is nothing beyond
   * them to show). Returns early — without scrolling — until the target card,
   * the viewport AND the content have all been measured, so a cold start never
   * scrolls on zero-sized geometry. The early exit also clears `animateNextRef`
   * so a stale tap cannot leak into a later programmatic switch.
   */
  const attemptCenter = useCallback(() => {
    const scroll = scrollRef.current
    const layout = cardLayoutsRef.current.get(desiredSlugRef.current)
    const viewportWidth = viewportWidthRef.current
    const contentWidth = contentWidthRef.current
    if (!scroll || !layout || viewportWidth <= 0 || contentWidth <= 0) {
      animateNextRef.current = false
      return
    }

    const maxX = Math.max(0, contentWidth - viewportWidth)
    const centerX = layout.x + layout.width / 2
    const targetX = Math.min(Math.max(centerX - viewportWidth / 2, 0), maxX)

    // Already there (repeated onLayout for the same geometry) → no-op. This is
    // the loop guard: a programmatic scroll does not re-measure content, so as
    // long as we never issue the same target twice, onLayout can't ping-pong.
    if (Math.abs(targetX - appliedXRef.current) < 0.5) {
      animateNextRef.current = false
      return
    }

    const animated = animateNextRef.current && !reducedMotionRef.current
    animateNextRef.current = false
    appliedXRef.current = targetX
    scroll.scrollTo({ x: targetX, animated })
  }, [])

  const handleMeasure = useCallback(
    (slug: string, layout: { x: number; width: number }) => {
      cardLayoutsRef.current.set(slug, layout)
      attemptCenter()
    },
    [attemptCenter],
  )

  useEffect(() => {
    desiredSlugRef.current = currentSlug
    attemptCenter()
  }, [currentSlug, substations, attemptCenter])

  const handleSelect = useCallback(
    (slug: string) => {
      // A tap is the ONLY animated path; `onSelect` flips `currentSlug` in the
      // parent, and the effect above centres the new card with animation. Tapping
      // the already-active card is a no-op in the parent, so it must NOT arm the
      // flag — otherwise a later external switch would animate.
      if (slug !== currentSlug) animateNextRef.current = true
      onSelect(slug)
    },
    [currentSlug, onSelect],
  )

  const handleViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportWidthRef.current = event.nativeEvent.layout.width
      attemptCenter()
    },
    [attemptCenter],
  )

  const handleContentSizeChange = useCallback(
    (width: number) => {
      contentWidthRef.current = width
      attemptCenter()
    },
    [attemptCenter],
  )

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Track the real offset so the guard above compares against reality, not a
    // stale target (the user may have flung the row by hand in between).
    appliedXRef.current = event.nativeEvent.contentOffset.x
  }, [])

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.container}
      horizontal
      showsHorizontalScrollIndicator={false}
      bounces={false}
      onLayout={handleViewportLayout}
      onContentSizeChange={handleContentSizeChange}
      onScroll={handleScroll}
      scrollEventThrottle={16}
    >
      {substations.map((sub) => (
        <SubstationCard
          key={sub.slug}
          substation={sub}
          isActive={sub.slug === currentSlug}
          onSelect={handleSelect}
          onMeasure={handleMeasure}
        />
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    width: '100%',
  },
  container: {
    // One row with a 16px content inset to match the header / APK button. The
    // inset is only visible at the two ends of the scroll: in the middle the
    // cards scroll straight past the viewport edges, so the row still reads as
    // full-bleed. This works with `attemptCenter` unchanged — the card `x` and
    // the content width both come from THIS container, so the padding is folded
    // into `centerX` and `contentWidth` alike and the clamp still lands the
    // first/last card exactly 16px from the edge.
    flexDirection: 'row',
    alignItems: 'center',
    gap: CARD_LIST_GAP,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  card: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: CARD_GAP,
    paddingVertical: CARD_PADDING_VERTICAL,
    paddingHorizontal: CARD_PADDING_HORIZONTAL,
    borderWidth: SURFACE_BORDER_WIDTH,
    borderRadius: SURFACE_RADIUS,
    // OPAQUE, not translucent. Android derives the elevation shadow's outline
    // from the background drawable; a translucent fill makes it rasterise the
    // shadow as an inset rectangle (uneven, worse on top) that only shows up on
    // the active/pressed card. The value is the exact composite of the previous
    // `rgba(255,255,255,0.05)` over the `#1a1a1a` (26) surface:
    // 26 + 0.05 × 229 ≈ 37 → `#252525`. Same look, no artefact.
    backgroundColor: '#252525',
    minWidth: CARD_MIN_SIZE,
    minHeight: CARD_MIN_SIZE,
    position: 'relative',
  },
  cardActive: {
    // Same reasoning as `card` above — the opaque composite of the previous
    // `rgba(255,255,255,0.09)`: 26 + 0.09 × 229 ≈ 47 → `#2f2f2f`. `elevation: 6`
    // (native) and the web `boxShadow` below are kept as-is.
    backgroundColor: '#2f2f2f',
    // `.substation-card--active`:
    //   box-shadow: 0 0 20px rgba(0,0,0,.3), inset 0 0 15px rgba(255,255,255,.02)
    // Web: exact CSS string — the legacy props below would drop the `inset`
    // term (react-native-web only builds a single outer box-shadow from them).
    // Native: outer shadow only; `inset` has no RN equivalent.
    ...Platform.select({
      web: {
        boxShadow: '0 0 20px rgba(0,0,0,0.3), inset 0 0 15px rgba(255,255,255,0.02)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 6,
      },
    }),
  },
  name: {
    fontSize: CARD_NAME_FONT_SIZE,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    letterSpacing: 0.5,
    lineHeight: CARD_NAME_LINE_HEIGHT,
    textAlign: 'center',
  },
  indicator: {
    position: 'absolute',
    top: CARD_INDICATOR_OFFSET,
    right: CARD_INDICATOR_OFFSET,
    fontSize: CARD_INDICATOR_FONT_SIZE,
  },
})
