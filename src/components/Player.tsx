import React, { useCallback, useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Easing,
  Platform,
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
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import type { PlayerState, StreamStatus } from '../types'
import { useReducedMotion } from '../hooks/useReducedMotion'

/** Diameter of the play button and of every pulse ring (`.play-btn` / `.pulse-ring`). */
const PLAY_BUTTON_SIZE = 140
/**
 * Deliberately 2× the old 48 — the glyph now reads at roughly 0.69 of the
 * button diameter (`96/140`). Do not "fix" it back down to 48.
 */
const PLAY_ICON_SIZE = 75
const RING_DURATION_MS = 2000
/**
 * CSS `animation-delay` per ring: 0s / 0.6s / 1.2s. Kept in ms as the verbatim
 * transcription of the web source values (so the derivation below is auditable
 * against `player.scss`); only the fractions in {@link RING_OFFSETS} are used at
 * runtime.
 */
const RING_DELAYS_MS = [0, 600, 1200]
/**
 * The same staggers expressed as fractions of ONE period (600/2000 = 0.3,
 * 1200/2000 = 0.6). Unlike a per-ring timer, an arithmetic offset on a shared
 * clock cannot drift: the gap is baked into the numbers, not into scheduling.
 */
const RING_OFFSETS = RING_DELAYS_MS.map((delay) => delay / RING_DURATION_MS)
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

/**
 * One expanding ripple (`pulse-ring` + `@keyframes pulseRing`):
 * scale 1 → 1.8, opacity 0.6 → 0 over 2s, looping forever.
 *
 * All three ripples are DERIVED FROM ONE CLOCK. `Player` owns `ringClock`, a
 * single linear 0 → 1 loop over `RING_DURATION_MS`; this helper only shifts that
 * clock by a constant arithmetic `offset`. The phase gap between any two rings
 * is therefore a constant of the math (the difference of their offsets) and is
 * structurally unable to drift — there is no second timer to race against.
 *
 * The clock is linear on purpose: the phase must advance proportionally to time.
 * The ease-out feel is applied AFTER the offset, to the derived phase
 * (`1 - (1 - phase)^3`), so easing never touches the phase relationship.
 *
 * Why NOT three independent `withDelay(withRepeat(withTiming(...)))` timers (the
 * previous design)? Reanimated's `repeat` restarts the inner timing from the
 * frame on which the previous repetition was *observed* to finish, not from its
 * exact mathematical end timestamp — every repetition absorbs up to one frame of
 * overshoot (see `react-native-reanimated/src/animation/repeat.ts`:
 * `onStart(..., now, ...)` uses the frame's `now`). Each ring was its own timer
 * and absorbed that overshoot on a
 * different frame, so the 600/1200ms offsets slowly wandered; eventually the
 * rings converged into lockstep and read as a single ring. Independent timers
 * carry no invariant tying them together — one shared clock does. Do not
 * reintroduce per-ring delays.
 *
 * `withRepeat(..., -1, reverse: false)` rewinds the shared value to its start
 * value on every repetition — that rewind is what keeps the ripple running, as
 * opposed to a built-in `Animated.loop` whose `timing` goes 0 → 1 once and then
 * animates nothing.
 *
 * The `'worklet'` directive is load-bearing: `Player` calls this helper from
 * inside three `useAnimatedStyle` callbacks, and a non-worklet function can't be
 * called on the UI thread. Passing the clock as a *parameter* (rather than as a
 * prop to a child component) is also deliberate — a missing clock can only ever
 * be a type error here, never a runtime `clock is undefined`.
 */
function ringStyle(clock: SharedValue<number>, offset: number, active: boolean) {
  'worklet'
  // Inactive: rings must be fully invisible. Resetting the clock alone is not
  // enough, because the offset rings would rest at a mid-period phase.
  if (!active) {
    return { opacity: 0, transform: [{ scale: 1 }] }
  }

  const phase = (clock.value + offset) % 1
  // Cubic ease-out on the derived phase (the clock itself stays linear).
  const eased = 1 - Math.pow(1 - phase, 3)

  // `0% { opacity: 0.6 }` → `100% { opacity: 0 }`. The extra 0-point keeps the
  // ring invisible right at the start of its cycle instead of popping in.
  return {
    opacity: interpolate(eased, [0, 0.001, 1], [0, RING_START_OPACITY, 0]),
    transform: [{ scale: interpolate(eased, [0, 1], [1, RING_MAX_SCALE]) }],
  }
}

export function Player({ state, status, onToggle, isLive = false, liveLabel }: PlayerProps) {
  const reducedMotion = useReducedMotion()
  const isPlaying =
    state === 'playing' || state === 'buffering' || state === 'loading' || state === 'reconnecting'
  const isLoading = state === 'loading' || state === 'buffering' || state === 'reconnecting'
  const isOffline = state === 'error' || state === 'offline' || state === 'reconnecting'
  const ringsActive = isPlaying && !reducedMotion

  // ONE clock for all pulse rings. A single linear 0 → 1 loop over one period;
  // each ring reads it with a constant arithmetic offset (see `ringStyle`).
  // The rings previously had one Reanimated timer each and drifted into
  // lockstep — one shared clock makes their phases an invariant.
  const ringClock = useSharedValue(0)

  // Three explicit `useAnimatedStyle` calls — a fixed count, so no hooks in a
  // loop. Each callback is auto-workletized by the Reanimated Babel plugin, picks
  // `ringClock` / `ringsActive` up from this component's closure, and calls the
  // shared `ringStyle` worklet directly: there is no prop through which the
  // clock could ever arrive undefined.
  const ring0Style = useAnimatedStyle(() => ringStyle(ringClock, RING_OFFSETS[0], ringsActive))
  const ring1Style = useAnimatedStyle(() => ringStyle(ringClock, RING_OFFSETS[1], ringsActive))
  const ring2Style = useAnimatedStyle(() => ringStyle(ringClock, RING_OFFSETS[2], ringsActive))

  useEffect(() => {
    if (!ringsActive) {
      // Paused / reduced motion: stop the clock and rewind it, so the rings are
      // gone rather than frozen mid-pulse (the ring styles also gate on `active`).
      cancelAnimation(ringClock)
      ringClock.value = 0
      return
    }

    // Restart from a clean phase, then loop forever. Linear easing is required:
    // the per-ring offsets are fractions of time, so the clock must advance
    // proportionally (the ease-out lives in `ringStyle`, after the offset).
    cancelAnimation(ringClock)
    ringClock.value = 0
    ringClock.value = withRepeat(
      withTiming(1, { duration: RING_DURATION_MS, easing: ReanimatedEasing.linear }),
      -1,
      false,
    )

    return () => {
      cancelAnimation(ringClock)
    }
  }, [ringsActive, ringClock])

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
        <Animated.View pointerEvents="none" style={[styles.pulseRing, ring0Style]} />
        <Animated.View pointerEvents="none" style={[styles.pulseRing, ring1Style]} />
        <Animated.View pointerEvents="none" style={[styles.pulseRing, ring2Style]} />

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
    // `.play-btn { box-shadow: 0 0 40px rgba(255,107,53,.35), 0 8px 32px rgba(0,0,0,.4) }`.
    // Web: pass the exact CSS string through — react-native-web maps a plain
    // `boxShadow` string verbatim (`mapBoxShadow` returns strings unchanged).
    // Native: approximate with the legacy shadow props. The centred orange halo
    // (offset 0/0) is the load-bearing part — it is what blooms onto the
    // near-black surface; the dark drop shadow is a web-only nicety.
    ...Platform.select({
      web: {
        boxShadow: '0 0 40px rgba(255,107,53,0.35), 0 8px 32px rgba(0,0,0,0.4)',
      },
      default: {
        shadowColor: '#ff6b35',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 40,
        elevation: 12,
      },
    }),
  },
  playButtonOffline: {
    // `.play-btn--offline { box-shadow: none }` — neutralise BOTH platform
    // paths (web `boxShadow` string, native legacy props).
    ...Platform.select({
      web: { boxShadow: 'none' },
      default: { shadowOpacity: 0, elevation: 0 },
    }),
  },
  playIconGlyph: {
    // Optical nudge for the Ionicons play triangle's left bias, scaled with
    // PLAY_ICON_SIZE (was 4 at size 48). Applied to the play state only — the
    // pause glyph must stay centred.
    marginLeft: 8,
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
