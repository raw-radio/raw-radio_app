import React, { useState, useCallback, useEffect } from 'react'
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
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
} from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { ANDROID_APP_DOWNLOAD_URL } from '../src/constants/androidAppDownload'
import {
  checkForUpdate,
  cleanupUpdateArtifacts,
  downloadAndInstall,
} from '../src/services/appUpdate'
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
import { APP_SURFACE_BG } from '../src/utils/layout'
import type { AppUpdateInfo, OnDemandTrack } from '../src/types'

/** Connection dot colors, mirrored from `.connection-dot--*` in player.scss. */
const DOT_CONNECTED = '#2bc96d'
const DOT_CONNECTED_BORDER = '#1a723f'
const DOT_DISCONNECTED = '#d64838'
/**
 * `dotPulse` — `animation: dotPulse 2s ease-in-out infinite`. The shared value
 * travels one direction per half-period, so a full breath is 2 × 1000ms = 2s,
 * matching the web keyframes (`0%/100% → 50% → 0%/100%`).
 */
const DOT_PULSE_HALF_MS = 2000
const DOT_PULSE_MIN_OPACITY = 0.2

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
  /** Non-null only on Android when GitHub Releases has a newer build. */
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)

  const reducedMotion = useReducedMotion()
  /** 0 → 1 → 0 breath, driven by a single shared value (Reanimated, UI thread). */
  const dotPulse = useSharedValue(0)

  useWakeLock(state === 'playing' || state === 'buffering' || state === 'loading')

  // Close the chat sheet if the admin disables chat while it is open.
  useEffect(() => {
    if (!chatIsOpen) setChatVisible(false)
  }, [chatIsOpen])

  // Push now-playing metadata to the OS media session. On web this feeds the
  // Media Session API (lock-screen/tray controls); on native `setNowPlaying`
  // calls `TrackPlayer.updateNowPlayingMetadata` so the Android notification
  // shows the same values (see `src/hooks/useAudioPlayer.ts`). One effect for
  // both platforms, so no platform branching at the call site.
  useEffect(() => {
    setNowPlaying({ title: status.trackTitle, artist: status.trackArtist })
  }, [status.trackTitle, status.trackArtist, setNowPlaying])

  // Sideloaded-APK update check — Android only, exactly once on mount.
  //
  // `checkForUpdate` resolves to `null` for every failure mode (offline, 403
  // rate limit, malformed payload, no newer tag) and is a no-op on web, so a
  // failed check can only ever mean "no affordance", never an error surface.
  // Deliberately not re-checked: we do not want to poll the GitHub API, and a
  // stale "update available" link is harmless (the installer still validates
  // the package).
  useEffect(() => {
    if (Platform.OS !== 'android') return

    // Cache sweep: drop update APKs left behind by a previous session. Only
    // artifacts older than a few minutes are touched — this is a MOUNT effect,
    // not process start, so a remount while the system installer is still
    // reading a freshly downloaded APK must not delete it (that install would
    // fail with "there was a problem parsing the package"). The default age gate
    // in `cleanupUpdateArtifacts` enforces the delay.
    cleanupUpdateArtifacts()

    let cancelled = false
    void checkForUpdate()
      .then((info) => {
        if (!cancelled) setUpdateInfo(info)
      })
      .catch(() => {
        // Defensive: the service is implemented to never reject.
      })

    return () => {
      cancelled = true
    }
  }, [])

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

  /**
   * Opens the Android APK download. Mirrors the `openExternal` pattern from
   * `app/copyright.tsx`: on web go through `window.open` so the download starts
   * in a new tab with `noopener,noreferrer`; `Linking.openURL` (which maps to
   * `window.open` on react-native-web) covers everything else. Never throws —
   * a blocked popup must not take the player down.
   *
   * `ANDROID_APP_DOWNLOAD_URL` comes from a platform-split module so the URL
   * literal stays out of the Android bundle (see `src/constants/androidAppDownload.ts`).
   */
  const handleDownloadAndroidApp = useCallback(() => {
    try {
      if (Platform.OS === 'web') {
        if (typeof window === 'undefined') return
        window.open(ANDROID_APP_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')
        return
      }

      void Linking.openURL(ANDROID_APP_DOWNLOAD_URL).catch(() => {
        // No handler for the URL — nothing else we can do.
      })
    } catch {
      // Popup blocked / URL handler missing — ignore.
    }
  }, [])

  /**
   * Downloads the newer APK and hands it to the Android package installer.
   *
   * Repeat taps are ignored while a download is in flight (`updateBusy`). Any
   * failure (network drop, no installer activity) resolves to the tappable
   * state again — the user can just tap once more; nothing is surfaced as an
   * error, and nothing here can take the player down.
   *
   * `startActivityAsync` resolves once the user leaves the installer, so the
   * busy state covers the whole confirmation flow. A successful install
   * restarts the app, after which `checkForUpdate` finds nothing new and the
   * affordance disappears on its own.
   */
  const handleUpdateApp = useCallback(() => {
    if (!updateInfo || updateBusy) return

    setUpdateBusy(true)
    void downloadAndInstall(updateInfo.apkUrl)
      .catch(() => {
        // Swallow — the button reverts to its normal state below.
      })
      .finally(() => {
        setUpdateBusy(false)
      })
  }, [updateInfo, updateBusy])

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

      {/*
        Bottom-right affordance under the station list (which scrolls
        internally), inset by the same 16px content edge as the rest of the
        page so it never turns the page itself into a scroll container.

        Web: the existing `Скачать APK` link that opens the release asset in a
        new tab. Android: `Обновить`, rendered ONLY while a newer sideloaded
        build exists — on the current version (and until the check resolves)
        this branch renders nothing at all.
      */}
      {Platform.OS === 'web' ? (
        <View style={styles.downloadRow}>
          <TouchableOpacity
            onPress={handleDownloadAndroidApp}
            style={styles.downloadLink}
            activeOpacity={0.6}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="link"
            accessibilityLabel="Скачать APK"
          >
            <Ionicons name="download-outline" size={15} color="#b3b3b3" />
            <Text style={styles.downloadLinkText} allowFontScaling={false}>
              Скачать APK
            </Text>
          </TouchableOpacity>
        </View>
      ) : updateInfo ? (
        <View style={styles.downloadRow}>
          <TouchableOpacity
            onPress={handleUpdateApp}
            disabled={updateBusy}
            style={styles.downloadLink}
            activeOpacity={0.6}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="link"
            accessibilityLabel="Обновить"
            accessibilityState={{ busy: updateBusy, disabled: updateBusy }}
          >
            {updateBusy ? (
              <ActivityIndicator size="small" color="#b3b3b3" />
            ) : (
              <Ionicons name="download-outline" size={15} color="#b3b3b3" />
            )}
            <Text style={styles.downloadLinkText} allowFontScaling={false}>
              Обновить
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
  container: { flex: 1, backgroundColor: APP_SURFACE_BG, overflow: 'hidden' },
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
  // Full-width row that only exists to hold the right-aligned APK link (web) /
  // `Обновить` affordance (Android) and inset it by the same 16px content edge
  // as the header / player / list, so it lines up with the content's right edge
  // and never touches the screen edge. `width: '100%'` keeps it a stable flex
  // child (its height does not depend on the link's intrinsic text width).
  downloadRow: {
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    alignItems: 'flex-end',
  },
  // Plain text link — deliberately quieter than any button: no background, no
  // border, no pill radius, no accent fill. Only the icon + label, muted grey.
  // The touch target is widened with `hitSlop` (on the TouchableOpacity) instead
  // of padding, so the text stays visually flush with the content right edge.
  downloadLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  downloadLinkText: {
    color: '#b3b3b3',
    fontSize: 13,
  },
})
