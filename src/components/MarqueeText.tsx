import React, { useCallback, useEffect, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useReducedMotion } from '../hooks/useReducedMotion'

/** Ticker speed — slow enough to read, fast enough to clear a long line. */
const DEFAULT_SPEED_PX_PER_SECOND = 50
/** Blank space between the two copies, so the loop reads as continuous. */
const DEFAULT_GAP_PX = 40

interface MarqueeTextProps {
  /**
   * One-line content (e.g. the title + separator + artist kept as separate
   * `Text`s so their colours survive) — rendered verbatim, twice when scrolling.
   */
  children: React.ReactNode
  /**
   * Spoken label for the whole line. Also doubles as the content identity used
   * to restart the ticker: it is derived from the same title/artist, so a mere
   * re-render does not restart the animation, but a text change does.
   */
  accessibilityLabel: string
  /** Fixed line height (px) — reserved even when there is nothing to show. */
  height: number
  /** Space between the two copies (px). */
  gapPx?: number
  /** Scroll speed (px per second). */
  speedPxPerSecond?: number
}

/**
 * Continuous horizontal ticker for a single line that may overflow.
 *
 * The line is measured rather than guessed: the outer box reports its own width
 * (`onLayout`) and the content copy reports its intrinsic width. Only when the
 * content is actually wider does the component render a SECOND copy and scroll
 * `translateX` from 0 to `-(contentWidth + gap)`, which hands the second copy
 * exactly where the first started — a seamless loop. A short line renders a
 * single, centred copy with no animation and no duplicate.
 *
 * Measurements live in state but are written only on a real change (guard in the
 * `onLayout` handlers); without that, `onLayout → setState → render → onLayout`
 * would spin forever. The animation effect depends only on the measurements and
 * the content label, so it never restarts on an unrelated re-render.
 *
 * Under "reduce motion" the ticker is dropped entirely: one copy, statically
 * truncated by the children's own `numberOfLines={1}` / `ellipsizeMode="tail"`.
 *
 * Accessibility: the outer box carries the label and the copies are hidden from
 * the accessibility tree (Android `no-hide-descendants`, iOS
 * `accessibilityElementsHidden`, web `aria-hidden`), so a screen reader speaks
 * the line once instead of twice.
 */
export function MarqueeText({
  children,
  accessibilityLabel,
  height,
  gapPx = DEFAULT_GAP_PX,
  speedPxPerSecond = DEFAULT_SPEED_PX_PER_SECOND,
}: MarqueeTextProps) {
  const reducedMotion = useReducedMotion()
  const [containerWidth, setContainerWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const translateX = useSharedValue(0)

  // Overflow drives alignment (start vs centre); animation adds the scroll on
  // top of it and is suppressed entirely under "reduce motion".
  const overflow = contentWidth > 0 && containerWidth > 0 && contentWidth > containerWidth
  const animating = !reducedMotion && overflow

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setContainerWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }, [])

  const handleContentLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width
    setContentWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }, [])

  useEffect(() => {
    // No overflow (or reduced motion): stop any running ticker and park the copy
    // at its resting position. This also covers unmount-time cleanup needs.
    if (!animating) {
      cancelAnimation(translateX)
      translateX.value = 0
      return
    }

    const distance = contentWidth + gapPx
    const duration = (distance / speedPxPerSecond) * 1000

    cancelAnimation(translateX)
    translateX.value = 0
    translateX.value = withRepeat(
      withTiming(-distance, { duration, easing: Easing.linear }),
      -1,
      false,
    )

    return () => {
      cancelAnimation(translateX)
    }
  }, [animating, contentWidth, gapPx, speedPxPerSecond, translateX, accessibilityLabel])

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }))

  return (
    <View
      style={[
        styles.container,
        { height },
        overflow ? styles.containerStart : styles.containerCenter,
      ]}
      accessible
      accessibilityLabel={accessibilityLabel}
      onLayout={handleContainerLayout}
    >
      <Animated.View style={[styles.track, { gap: gapPx }, animatedStyle]}>
        <View
          style={styles.copy}
          onLayout={handleContentLayout}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          aria-hidden
        >
          {children}
        </View>
        {animating && (
          <View
            style={styles.copy}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            aria-hidden
          >
            {children}
          </View>
        )}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Short line: centre the single copy (parity with the old centred now-playing row).
  containerCenter: {
    justifyContent: 'center',
  },
  // Scrolling: pin the overflowing track to the start, so `translateX` moves the
  // first copy out to the left instead of the row being centred off-screen.
  containerStart: {
    justifyContent: 'flex-start',
  },
  // Intrinsic width (never shrinks) so the copies keep their full text and the
  // content width we measure is the real overflow width.
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
})
