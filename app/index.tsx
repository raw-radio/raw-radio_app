import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
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
const DOT_CONNECTED = '#2ecc71'
const DOT_DISCONNECTED = '#e74c3c'
/** `dotPulse` — 2s ease-in-out, half-period for each direction. */
const DOT_PULSE_HALF_MS = 1000
const DOT_PULSE_MIN_OPACITY = 0.5
const DOT_PULSE_MIN_SCALE = 0.85

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

export default function HomeScreen() {
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
    toggle, state, volume, setVolume, muted, toggleMute,
    mode, currentTrack, trackProgress, playTrack, stopTrack,
  } = useAudioPlayer(currentSlug)

  const [searchOpen, setSearchOpen] = useState(false)
  const [chatVisible, setChatVisible] = useState(false)

  const reducedMotion = useReducedMotion()
  const dotOpacity = useRef(new Animated.Value(1)).current
  const dotScale = useRef(new Animated.Value(1)).current

  useWakeLock(state === 'playing' || state === 'buffering' || state === 'loading')

  // Close the chat sheet if the admin disables chat while it is open.
  useEffect(() => {
    if (!chatIsOpen) setChatVisible(false)
  }, [chatIsOpen])

  const isPlaying =
    state === 'playing' || state === 'buffering' || state === 'loading' || state === 'reconnecting'
  const isLive = status.type === 'live' || showLiveLabel

  const dotPulsing = connected && isPlaying && !reducedMotion
  const dotColor = connected ? DOT_CONNECTED : DOT_DISCONNECTED
  const connectionLabel = connected ? (isPlaying ? 'Connected — playing' : 'Connected') : 'Disconnected'

  // `connection-dot--playing` — animate opacity/scale only while the stream plays.
  useEffect(() => {
    if (!dotPulsing) {
      dotOpacity.stopAnimation()
      dotScale.stopAnimation()
      dotOpacity.setValue(1)
      dotScale.setValue(1)
      return
    }

    const opacityAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(dotOpacity, {
          toValue: DOT_PULSE_MIN_OPACITY,
          duration: DOT_PULSE_HALF_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity, {
          toValue: 1,
          duration: DOT_PULSE_HALF_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    const scaleAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(dotScale, {
          toValue: DOT_PULSE_MIN_SCALE,
          duration: DOT_PULSE_HALF_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dotScale, {
          toValue: 1,
          duration: DOT_PULSE_HALF_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    opacityAnimation.start()
    scaleAnimation.start()

    return () => {
      opacityAnimation.stop()
      scaleAnimation.stop()
    }
  }, [dotOpacity, dotPulsing, dotScale])

  const handlePlay = useCallback(async () => {
    await toggle()
    refreshNowPlaying()
  }, [toggle, refreshNowPlaying])

  const handleTrackSelect = useCallback((track: OnDemandTrack) => {
    setSearchOpen(false)
    playTrack(track)
  }, [playTrack])

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
                opacity: dotOpacity,
                transform: [{ scale: dotScale }],
              },
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

      <TrackSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} onTrackSelect={handleTrackSelect} />
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
