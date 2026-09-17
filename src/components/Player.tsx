import React, { useCallback, useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Animated, {
  cancelAnimation,
  Easing as ReanimatedEasing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import type { PlayerState, StreamStatus } from '../types'
import { useReducedMotion } from '../hooks/useReducedMotion'

/** Diameter of the play button and of every pulse ring (`.play-btn` / `.pulse-ring`). */
const PLAY_BUTTON_SIZE = 140
const PLAY_ICON_SIZE = 48
const RING_DURATION_MS = 2000
/** CSS `animation-delay` per ring: 0s / 0.6s / 1.2s. */
const RING_DELAYS_MS = [0, 600, 1200]
const RING_MAX_SCALE = 1.8
const RING_START_OPACITY = 0.6

/** `.play-btn:active { transform: scale(0.95) }` — press-in scale (native-driver safe). */
const PRESS_SCALE = 0.95
/** Press timings, within the web `.play-btn { transition: all 300ms ease }` budget. */
const PRESS_IN_MS = 150
const PRESS_OUT_MS = 200

const ACCENT_GRADIENT = ['#ff6b35', '#ff4500'] as const
const OFFLINE_GRADIENT = ['#2a2a2a', '#2a2a2a'] as const

interface PlayerProps {
  state: PlayerState
  status: StreamStatus
  onToggle: () => void
  isLive?: boolean
  liveLabel?: string
}

interface PulseRingProps {
  /** Stagger offset in ms, applied ONCE at start (CSS `animation-delay` parity). */
  delay: number
  active: boolean
}

/**
 * One expanding ripple (`pulse-ring` + `@keyframes pulseRing`):
 * scale 1 → 1.8, opacity 0.6 → 0 over 2s, looping forever.
 *
 * `withDelay` applies the stagger only once, before the loop starts, so every
 * ring then has an exact 2000ms period (CSS `animation-delay: 0s/0.6s/1.2s` +
 * `infinite`). `withRepeat(..., -1, reverse: false)` rewinds the shared value to
 * its start value on every repetition — that rewind is what keeps the ripple
 * running, instead of a built-in `Animated.loop` whose `timing` goes 0 → 1 only
 * once and then animates nothing. A single `progress` value drives both
 * `transform: scale` and `opacity`, which are native-driver safe.
 */
function PulseRing({ delay, active }: PulseRingProps) {
  const progress = useSharedValue(0)

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress)
      progress.value = 0
      return
    }

    // Restart from a clean phase, then: one-time stagger delay → infinite loop.
    cancelAnimation(progress)
    progress.value = 0
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, {
          duration: RING_DURATION_MS,
          easing: ReanimatedEasing.out(ReanimatedEasing.ease),
        }),
        -1,
        false,
      ),
    )

    return () => {
      cancelAnimation(progress)
    }
  }, [active, delay, progress])

  // `0% { opacity: 0.6 }` → `100% { opacity: 0 }`. The extra 0-point keeps the
  // ring invisible during the stagger delay instead of leaving a static circle.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.001, 1], [0, RING_START_OPACITY, 0]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, RING_MAX_SCALE]) }],
  }))

  return <Animated.View pointerEvents="none" style={[styles.pulseRing, animatedStyle]} />
}

export function Player({ state, status, onToggle, isLive = false, liveLabel }: PlayerProps) {
  const reducedMotion = useReducedMotion()
  const isPlaying =
    state === 'playing' || state === 'buffering' || state === 'loading' || state === 'reconnecting'
  const isLoading = state === 'loading' || state === 'buffering' || state === 'reconnecting'
  const isOffline = state === 'error' || state === 'offline' || state === 'reconnecting'
  const ringsActive = isPlaying && !reducedMotion

  const trackTitle = status.trackTitle
  const trackArtist = status.trackArtist
  const hasTrack = !!trackTitle

  // Press feedback: the play button element scales down on press-in and back up
  // on press-out (mirrors `.play-btn:active`). Transform-only → native driver.
  // Built-in `RNAnimated` (not Reanimated) is kept here on purpose; the wrapper
  // is NOT animated, so the pulse rings keep running untouched.
  const pressScale = useRef(new RNAnimated.Value(1)).current

  const handlePressIn = useCallback(() => {
    RNAnimated.timing(pressScale, {
      toValue: PRESS_SCALE,
      duration: PRESS_IN_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start()
  }, [pressScale])

  const handlePressOut = useCallback(() => {
    RNAnimated.timing(pressScale, {
      toValue: 1,
      duration: PRESS_OUT_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start()
  }, [pressScale])

  return (
    <View style={styles.hero}>
      <View style={styles.playButtonWrap}>
        {RING_DELAYS_MS.map((delay) => (
          <PulseRing key={delay} delay={delay} active={ringsActive} />
        ))}

        <Pressable
          style={styles.playButtonTouchable}
          onPress={onToggle}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        >
          <RNAnimated.View
            style={[styles.playButtonScaler, { transform: [{ scale: pressScale }] }]}
          >
            <LinearGradient
              colors={isOffline ? OFFLINE_GRADIENT : ACCENT_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.playButton, isOffline && styles.playButtonOffline]}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={PLAY_ICON_SIZE}
                color={isOffline ? '#737373' : '#fff'}
                style={!isPlaying ? styles.playIconGlyph : undefined}
              />
            </LinearGradient>

            {isLoading && (
              <View style={styles.spinnerOverlay} pointerEvents="none">
                <ActivityIndicator size="large" color="#ff6b35" />
              </View>
            )}
          </RNAnimated.View>
        </Pressable>
      </View>

      {isLive ? (
        <View style={styles.nowPlaying}>
          <Text style={[styles.trackTitle, styles.trackTitleLive]} numberOfLines={1} ellipsizeMode="tail">
            {liveLabel?.trim() || 'Listen live'}
          </Text>
        </View>
      ) : (
        hasTrack && (
          <View style={styles.nowPlaying}>
            <Text style={styles.trackTitle} numberOfLines={1} ellipsizeMode="tail">
              {trackTitle}
            </Text>
            {trackArtist && (
              <>
                <Text style={styles.trackSeparator}>—</Text>
                <Text style={styles.trackArtist} numberOfLines={1} ellipsizeMode="tail">
                  {trackArtist}
                </Text>
              </>
            )}
          </View>
        )
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    paddingHorizontal: 16,
    marginTop: 40,
    marginBottom: 24,
  },
  playButtonWrap: {
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    // `.play-btn-wrap { margin-bottom: 60px }` on web — gap to the now-playing title.
    marginBottom: 60,
  },
  pulseRing: {
    position: 'absolute',
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: PLAY_BUTTON_SIZE / 2,
    borderWidth: 2,
    borderColor: 'rgba(255, 107, 53, 0.4)',
  },
  playButtonTouchable: {
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: PLAY_BUTTON_SIZE / 2,
  },
  /** Scaled element only — keeps the rings container (and their loop) independent. */
  playButtonScaler: {
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: PLAY_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: PLAY_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // box-shadow: 0 0 40px rgba(255,107,53,0.35), 0 8px 32px rgba(0,0,0,0.4)
    shadowColor: '#ff6b35',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 32,
    elevation: 12,
  },
  playButtonOffline: {
    shadowOpacity: 0,
    elevation: 0,
  },
  playIconGlyph: {
    marginLeft: 4,
  },
  spinnerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PLAY_BUTTON_SIZE / 2,
    backgroundColor: 'rgba(13, 13, 13, 0.8)',
  },
  nowPlaying: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'center',
    // `alignSelf: stretch` + `maxWidth: 100%` bound the row to the viewport, so
    // the shrinking children below can actually truncate instead of stretching
    // the row past the screen edge (mirrors `.hero-now-playing`).
    alignSelf: 'stretch',
    maxWidth: '100%',
    paddingHorizontal: 16,
    // The 60px gap to the play button lives on `.play-btn-wrap` (web parity).
    marginTop: 0,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: '100%',
    minWidth: 0,
    flexShrink: 1,
  },
  trackTitleLive: {
    color: '#ff6b35',
  },
  trackSeparator: {
    color: '#b3b3b3',
    fontSize: 18,
    lineHeight: 24,
    marginHorizontal: 5,
    // `.hero-track-separator { flex-shrink: 0 }`
    flexShrink: 0,
  },
  trackArtist: {
    color: '#b3b3b3',
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: '100%',
    minWidth: 0,
    flexShrink: 1,
  },
})
