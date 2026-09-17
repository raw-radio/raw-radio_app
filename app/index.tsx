import React, { useState, useCallback, useEffect } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing as ReanimatedEasing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useAudioPlayer } from '../src/hooks/useAudioPlayer'
import { useStreamStatus } from '../src/hooks/useStreamStatus'
import { useSubstations } from '../src/hooks/useSubstations'
import { useChat } from '../src/hooks/useChat'
import { useWakeLock } from '../src/hooks/useWakeLock'
import { useReducedMotion } from '../src/hooks/useReducedMotion'
import { Player } from '../src/components/Player'
import { VolumeSlider } from '../src/components/VolumeSlider'
import { SubstationSelector } from '../src/components/SubstationSelector'
import { TrackSearchModal } from '../src/components/TrackSearchModal'
import { PlayerBar } from '../src/components/PlayerBar'
import { ChatSheet } from '../src/components/ChatSheet'
import { ShareButton } from '../src/components/ShareButton'
import type { OnDemandTrack } from '../src/types'

/** Connection dot colors, mirrored from `.connection-dot--*` in player.scss. */
const DOT_CONNECTED = '#2bc96d'
const DOT_CONNECTED_BORDER = '#1a723f'
const DOT_DISCONNECTED = '#d64838'
/**
 * `dotPulse` — `animation: dotPulse 2s ease-in-out infinite`. The shared value
 * travels one direction per half-period, so a full breath is 2 × 1000ms = 2s,
 * matching the web keyframes (`0%/100% → 50% → 0%/100%`).
 */
const DOT_PULSE_HALF_MS = 1000
const DOT_PULSE_MIN_OPACITY = 0.3

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

export default function HomeScreen() {
  const router = useRouter()
  const { substations, currentSlug, selectSubstation } = useSubstations()
  const { status, connected, refreshNowPlaying } = useStreamStatus(currentSlug)
  const {
    isOpen: chatIsOpen,
    isLoading: chatIsLoading,
    messages,
    showLiveLabel,
    liveLabelText,
  } = useChat(currentSlug)
  const {
    toggle,
    state,
    volume,
    setVolume,
    muted,
    toggleMute,
    mode,
    currentTrack,
    trackProgress,
    playTrack,
    stopTrack,
    setNowPlaying,
  } = useAudioPlayer(currentSlug)

  const [searchOpen, setSearchOpen] = useState(false)
  const [chatVisible, setChatVisible] = useState(false)

  const reducedMotion = useReducedMotion()
  /** 0 → 1 → 0 breath, driven by a single shared value (Reanimated, UI thread). */
  const dotPulse = useSharedValue(0)

  useWakeLock(state === 'playing' || state === 'buffering' || state === 'loading')

  // Close the chat sheet if the admin disables chat while it is open.
  useEffect(() => {
    if (!chatIsOpen) setChatVisible(false)
  }, [chatIsOpen])

  // Push now-playing metadata to the OS media session. On web this feeds the
  // Media Session API (lock-screen/tray controls); on native it is a no-op and
  // react-native-track-player owns the system controls. One effect for both
  // platforms, so no platform branching at the call site.
  useEffect(() => {
    setNowPlaying({ title: status.trackTitle, artist: status.trackArtist })
  }, [status.trackTitle, status.trackArtist, setNowPlaying])

  const isPlaying =
    state === 'playing' || state === 'buffering' || state === 'loading' || state === 'reconnecting'
  const isLive = status.type === 'live' || showLiveLabel

  const dotPulsing = connected && isPlaying && !reducedMotion
  const dotColor = connected ? DOT_CONNECTED : DOT_DISCONNECTED
  const dotBorderColor = connected ? DOT_CONNECTED_BORDER : DOT_DISCONNECTED
  const connectionLabel = connected
    ? isPlaying
      ? 'Connected — playing'
      : 'Connected'
    : 'Disconnected'

  // `connection-dot--playing` — animate opacity/scale only while the stream plays.
  //
  // `withRepeat(..., -1, reverse: true)` makes the shared value travel 0 → 1 → 0
  // continuously: the reverse leg IS the second half of the cycle, so the value
  // never has to snap back to its origin at a cycle boundary (which is exactly
  // what made the previous `Animated.loop` + `reverse: false` sequence janky).
  // `Easing.inOut(Easing.ease)` keeps both turnarounds soft, matching the web's
  // `ease-in-out`.
  //
  // The dependency list holds ONLY the gating boolean and the shared value (which
  // is stable): no object/array is recreated per render, so an unrelated re-render
  // can no longer tear down and restart the loop mid-breath.
  useEffect(() => {
    if (!dotPulsing) {
      cancelAnimation(dotPulse)
      dotPulse.value = 0
      return
    }

    // Restart from a clean phase, then breathe forever.
    cancelAnimation(dotPulse)
    dotPulse.value = 0
    dotPulse.value = withRepeat(
      withTiming(1, {
        duration: DOT_PULSE_HALF_MS,
        easing: ReanimatedEasing.inOut(ReanimatedEasing.ease),
      }),
      -1,
      true,
    )

    return () => {
      cancelAnimation(dotPulse)
    }
  }, [dotPulsing, dotPulse])

  // Single style object for both properties → one shared value, one driver,
  // perfect phase sync between opacity and scale (the old code ran two
  // independent `Animated.loop`s that could drift apart).
  // The glow stays static on purpose, like `.connection-dot`'s static
  // `box-shadow`: animated shadow props are not portable (Android draws shadows
  // via `elevation` only, and react-native-web prefers `boxShadow`), so
  // animating them would risk platform warnings for no visual gain.
  const dotAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dotPulse.value, [0, 1], [1, DOT_PULSE_MIN_OPACITY]),
  }))

  const handlePlay = useCallback(async () => {
    await toggle()
    refreshNowPlaying()
  }, [toggle, refreshNowPlaying])

  const handleTrackSelect = useCallback(
    (track: OnDemandTrack) => {
      setSearchOpen(false)
      playTrack(track)
    },
    [playTrack],
  )

  return (
    <View style={styles.container}>
      {/* Header: logo + connection dot on the left, actions on the right */}
      <View style={styles.header}>
        <View style={styles.headerLogo}>
          <LinearGradient
            colors={['#ff6b35', '#ff4500']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoIcon}
          >
            <Text style={styles.logoIconText} allowFontScaling={false}>
              R
            </Text>
          </LinearGradient>
          <Text style={styles.logoText} allowFontScaling={false}>
            RAW
            <Text style={styles.logoTextAccent}>RADIO</Text>
          </Text>
          <Animated.View
            accessible
            accessibilityLabel={connectionLabel}
            style={[
              styles.connectionDot,
              {
                backgroundColor: dotColor,
                shadowColor: dotColor,
                borderColor: dotBorderColor,
              },
              dotAnimatedStyle,
            ]}
          />
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setSearchOpen(true)}
            style={styles.headerBtn}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Search tracks"
          >
            <Ionicons name="search" size={18} color="#b3b3b3" />
          </TouchableOpacity>
          <ShareButton slug={currentSlug || 'main'} />
          {/* Chat is available only when enabled in the admin settings — mirrors web. */}
          {!chatIsLoading && chatIsOpen && (
            <TouchableOpacity
              onPress={() => setChatVisible(true)}
              style={styles.headerBtn}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Чат с ведущим"
            >
              <Ionicons name="chatbubble-ellipses" size={18} color="#b3b3b3" />
            </TouchableOpacity>
          )}
          {/* Legal page — same ShieldCheck action as the web player header. */}
          <TouchableOpacity
            onPress={() => router.push('/copyright')}
            style={styles.headerBtn}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Правообладателям"
          >
            <Ionicons name="shield-checkmark" size={18} color="#b3b3b3" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Player sits above the station list, like the web player */}
      <Player
        state={state}
        status={status}
        onToggle={handlePlay}
        isLive={isLive}
        liveLabel={liveLabelText ?? undefined}
      />

      <VolumeSlider volume={volume} muted={muted} onChange={setVolume} onToggleMute={toggleMute} />

      <SubstationSelector
        substations={substations}
        currentSlug={currentSlug || 'main'}
        onSelect={selectSubstation}
      />

      {mode === 'track' && currentTrack && (
        <PlayerBar track={currentTrack} progress={trackProgress} onStop={stopTrack} />
      )}

      <TrackSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onTrackSelect={handleTrackSelect}
      />
      {!chatIsLoading && chatIsOpen && (
        <ChatSheet
          isOpen={chatVisible}
          onClose={() => setChatVisible(false)}
          substationSlug={currentSlug}
          messages={messages}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // `overflow: hidden` clips horizontally — a long now-playing title can never
  // widen the root and force horizontal scrolling.
  container: { flex: 1, backgroundColor: '#0d0d0d', overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    marginBottom: 24,
  },
  headerLogo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIconText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  logoText: {
    color: '#fff',
    fontFamily: MONO_FONT,
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: -0.3,
  },
  logoTextAccent: { color: '#ff6b35' },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    borderWidth: 1,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
