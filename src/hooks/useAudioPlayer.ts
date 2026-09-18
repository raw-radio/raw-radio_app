import { useState, useEffect, useRef, useCallback } from 'react'
import { AppState, Image, Platform } from 'react-native'
import Constants from 'expo-constants'
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  State as TrackPlayerState,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player'
import { storage, STORAGE_KEYS } from './useStorage'
import { getTrackStreamUrl } from '../api/client'
import { sanitizeMediaText } from '../utils/format'
import type { PlayerState, PlayerMode, OnDemandTrack, NowPlayingMeta } from '../types'

const MAX_RETRY_DELAY = 30000
// Watchdog cadence and "no audio progress" threshold (radio mode only).
const WATCHDOG_INTERVAL = 5000
const STALL_TIMEOUT = 15000
// Fallback now-playing labels so the tray/lock-screen card is never blank.
const NOW_PLAYING_FALLBACK = 'RAW Radio'

/**
 * Why `tryPlay()` was called. The literal is load-bearing: `'reconnect'` is
 * armed only after an explicit failure (error state / stall watchdog), so it
 * must ALWAYS take the destructive reset/add/play path — the fast path (which
 * reuses an already-loaded queue) is skipped for it. A dead-but-open stream
 * that RNTP still reports as `Playing` would otherwise be fast-pathed forever
 * and never rebuilt, breaking stall recovery.
 */
type TryPlayReason = 'user-play' | 'stop-track' | 'reconnect' | 'slug-change'

/**
 * Notification / lock-screen capabilities. Kept in sync with the events handled
 * by `src/services/trackPlayerService.ts` — never advertise a control the
 * playback service does not implement:
 *   Play/Pause  ↔ Event.RemotePlay / Event.RemotePause
 *   Stop        ↔ Event.RemoteStop
 *   Skip*       ↔ Event.RemoteNext / Event.RemotePrevious
 */
const NOTIFICATION_CAPABILITIES = [
  Capability.Play,
  Capability.Pause,
  Capability.Stop,
  Capability.SkipToNext,
  Capability.SkipToPrevious,
]

/**
 * Builds the COMPLETE `TrackPlayer.updateOptions()` payload for a given
 * "app killed from recents" behaviour.
 *
 * `updateOptions` is NOT a merge: the native side rebuilds the player commands
 * and the media-session configuration from the payload it receives
 * (`MusicService.updateOptions`, MusicService.kt:218-262), so a field omitted
 * from a later call is reset rather than kept. Specifically, the
 * `capabilities` / `notificationCapabilities` lists fall back to empty (and
 * `notificationCapabilities` then mirrors `capabilities`),
 * `android.appKilledPlaybackBehavior` falls back to `ContinuePlayback`,
 * and `pauseOnInterruption` / `android.shuffle` fall back to `false`. Only a few
 * keys are read "if present" (`android.audioOffload`, `android.skipSilence`, and
 * `android.stopForegroundGracePeriod` — MusicService.kt:222-237). This hook
 * switches `android.appKilledPlaybackBehavior` dynamically (see
 * `applyAppKilledBehavior`), so every call — including the one at init — must
 * pass the full set of capabilities. Routing them all through this one builder
 * is what makes drift between the init call and the later calls impossible.
 *
 * Tray disappearing when the app is killed while PAUSED:
 * `ContinuePlayback` makes `onTaskRemoved` a no-op
 * (MusicService.kt:750), so the notification would persist forever after a kill
 * while paused (`stopForegroundGracePeriod` is dead config in this alpha).
 * `StopPlaybackAndRemoveNotification` is the only removal path, but it tears the
 * service down and calls `exitProcess(0)` (MusicService.kt:729-747). Hence the
 * switch is dynamic: playing ⇒ ContinuePlayback (audio survives the kill),
 * paused ⇒ StopPlaybackAndRemoveNotification (a paused+killed app dies
 * completely — no notification, next launch is cold).
 */
function buildPlayerOptions(appKilledPlaybackBehavior: AppKilledPlaybackBehavior) {
  return {
    android: { appKilledPlaybackBehavior },
    capabilities: NOTIFICATION_CAPABILITIES,
    notificationCapabilities: NOTIFICATION_CAPABILITIES,
  }
}

/**
 * URI of the square 1024×1024 app icon (`assets/icon.png`), used as the
 * tray/lock-screen artwork of the radio stream (tracks have no artwork of their
 * own).
 *
 * `Image.resolveAssetSource` turns a `require()`d bundled asset into the URI
 * string that `updateNowPlayingMetadata` accepts. Caveat: in a **release
 * Android** build the JS bundle is loaded from the APK (not a `file://` path),
 * so React Native resolves the asset to a bare AAPT resource name — for this
 * asset `assets_icon` (emitted as `drawable-mdpi/assets_icon.png`) — with no
 * URI scheme, and Media3's Coil bitmap loader cannot load a scheme-less URI.
 * It is therefore rewritten to an `android.resource://` URI. In
 * development the resolved URI is an http URL and is used as-is.
 *
 * Resolved once per process and cached. Best-effort: never throws.
 */
let artworkUriCache: string | null | undefined

function getArtworkUri(): string | undefined {
  if (artworkUriCache !== undefined) return artworkUriCache ?? undefined

  try {
    // A static import cannot be used here: TypeScript has no `*.png` module
    // declaration in this project, so `require` is the RN-idiomatic way to
    // reference the bundled asset.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const resolved = Image.resolveAssetSource(require('../../assets/icon.png'))
    let uri = resolved?.uri
    if (uri && Platform.OS === 'android' && !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
      const pkg = Constants.expoConfig?.android?.package
      if (pkg) uri = `android.resource://${pkg}/drawable/${uri}`
    }
    artworkUriCache = uri || null
  } catch {
    artworkUriCache = null
  }

  return artworkUriCache ?? undefined
}

export function useAudioPlayer(currentSlug: string | undefined) {
  const [state, setState] = useState<PlayerState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [mode, setMode] = useState<PlayerMode>('radio')
  const [currentTrack, setCurrentTrack] = useState<OnDemandTrack | null>(null)

  const playbackState = usePlaybackState()
  const { position, duration } = useProgress(250)

  const trackProgress = { currentTime: position, duration }

  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPlayingRef = useRef(false)
  // URL this instance last loaded (or, on mount, the one the previous session
  // left loaded). The slug-change effect compares against it so a "change" that
  // already points at the loaded stream does not tear the stream down and back
  // up (re-tap of the current station, persisted slug resolving after mount).
  const currentUrlRef = useRef('')
  const savedSlugRef = useRef(currentSlug || 'main')
  // Last slug this hook actually reacted to. Seeded with the initial slug so the
  // mount itself is not a "change" — that is what keeps a cold start from
  // auto-starting playback. (An earlier `userInitiatedRef` gate approximated this
  // and, worse, silently dropped every station switch made after a relaunch.)
  const prevSlugRef = useRef(currentSlug || 'main')
  const modeRef = useRef<PlayerMode>('radio')
  const initializedRef = useRef(false)
  const prevVolumeRef = useRef(1)
  // Resolves once the init chain — probe, `setupPlayer()`, options, volume
  // restore, mount seed — has settled. Never rejects (the failure is reported
  // through `error`/`state` instead), so `await`ing it can never strand a caller.
  const setupPromiseRef = useRef<Promise<void> | null>(null)
  const readyRef = useRef(false)
  // Android "app killed from recents" behaviour that should be applied to the
  // native player. `updateOptions` re-derives the options from each payload
  // (absent fields reset — see `buildPlayerOptions`), so the desired value is
  // tracked here and re-applied with the full option set every time the
  // play/pause intent flips.
  const appKilledBehaviorRef = useRef<AppKilledPlaybackBehavior>(
    AppKilledPlaybackBehavior.ContinuePlayback,
  )
  // Last behaviour actually written to the native player; skips redundant
  // `updateOptions` round-trips. Only read/written from inside the serialized
  // write chain (`behaviorWriteChainRef`), so it can never be observed
  // mid-flight holding the value an older, still-running write is about to
  // supersede.
  const appliedKilledBehaviorRef = useRef<AppKilledPlaybackBehavior | null>(null)
  // Monotonic id of the newest behaviour intent. A queued write that has been
  // superseded before it starts is dropped instead of landing late.
  const behaviorRequestRef = useRef(0)
  // Tail of the serialized native-`updateOptions` write chain. Chaining the
  // writes — instead of firing them concurrently — is what makes "the last
  // intent wins" a structural guarantee: while one `updateOptions` round-trip is
  // in flight, no other one can start (and the dedup in
  // `applyAppKilledBehavior` can therefore never mistake "in flight" for
  // "already applied").
  const behaviorWriteChainRef = useRef<Promise<void>>(Promise.resolve())
  // Latest `playTrack`, so `play()` can restart the current on-demand track
  // (declared later in this hook, but reachable through the ref).
  const playTrackRef = useRef<(track: OnDemandTrack) => Promise<void>>(async () => {})
  // Monotonic id of the newest load request (radio or on-demand track). Every
  // await below re-checks it, because RNTP owns a single queue: an older request
  // that resumes after a newer one must not reset/add/play on top of it.
  const playRequestRef = useRef(0)

  // --- Now-playing / tray state (native only) -------------------------------
  // True once a track has been added to the RNTP queue. A WS status update can
  // arrive before the first `play()`, so the tray update must wait for a queue
  // (`updateNowPlayingMetadata` rejects with `no_current_item` without one).
  const hasQueueRef = useRef(false)
  // Latest now-playing metadata reported by the stream status (radio mode).
  const nowPlayingRef = useRef<{ title: string; artist: string }>({
    title: NOW_PLAYING_FALLBACK,
    artist: NOW_PLAYING_FALLBACK,
  })
  // What is currently displayed in the tray — skips redundant native calls when
  // a chatty WebSocket repeats the same track.
  const publishedNowPlayingRef = useRef<{ title: string; artist: string } | null>(null)

  // --- Stall watchdog state -------------------------------------------------
  // Timestamp of the last observed position change. RNTP reports "Playing"
  // even when the stream has silently frozen (dead-but-open connection), which
  // produces neither an Error nor a Buffering state — no watchdog, no recovery.
  const lastProgressAtRef = useRef(Date.now())
  // True once position has actually advanced for the current load. Guards the
  // progress rule so a stream that simply reports no position is not judged.
  const progressSeenRef = useRef(false)
  // Latest RNTP state for the interval callback (avoids stale closures).
  const playbackStateRef = useRef<TrackPlayerState | undefined>(TrackPlayerState.None)
  // Whether the app is in the foreground; the watchdog stays quiet in background.
  const appActiveRef = useRef(true)
  // Foreground-resume grace window. The `AppState` event and the watchdog timer
  // are independent event sources, and the native state re-read on resume is
  // async, so a tick that is already queued when the app returns could still run
  // before that re-read settles. Any tick inside this window is skipped. The
  // unconditional baseline rebase in the AppState handler is the primary fix for
  // the post-resume false stall — this window is defence-in-depth, not the fix.
  const resumeGraceUntilRef = useRef(0)

  const buildStreamUrl = useCallback((slug: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL || ''
    return `${base}/${slug}.mp3`
  }, [])

  /**
   * Switch `android.appKilledPlaybackBehavior` on the live player — the ONLY
   * removal path for the media notification (`ContinuePlayback` makes
   * `onTaskRemoved` a no-op, MusicService.kt:750). Called on every play path
   * with `ContinuePlayback` and on every pause path with
   * `StopPlaybackAndRemoveNotification`.
   *
   * Best-effort by design (a failed options update must never break playback).
   * "The last intent wins" is enforced structurally, in three parts:
   *   1. the desired value is recorded synchronously in
   *      `appKilledBehaviorRef`, so it is never stale;
   *   2. writes are serialized through `behaviorWriteChainRef`, so a write can
   *      never be observed as applied while an older round-trip for the opposite
   *      value is still in flight (which is exactly what used to let the dedup
   *      below swallow the newest intent);
   *   3. `behaviorRequestRef` is a monotonic id, so a write that was superseded
   *      while queued is dropped instead of landing late.
   * A failed write clears `appliedKilledBehaviorRef` — the native options are
   * then unknown, so the next call must re-apply them.
   *
   * Safe to call before `setupPlayer()` resolves: the chain awaits
   * `setupPromiseRef` and re-checks the id afterwards. If the promise is still
   * null, the init effect has not published it yet, which also means its own
   * `updateOptions` (which reads `appKilledBehaviorRef.current`) has not run —
   * so the intent recorded here is picked up there instead of being lost.
   *
   * The payload is always the FULL option set from `buildPlayerOptions`, never a
   * partial one.
   */
  const applyAppKilledBehavior = useCallback((behavior: AppKilledPlaybackBehavior) => {
    // Record the desired value synchronously: the native write may be skipped
    // by the dedup/id checks below, but the intent must never be stale.
    appKilledBehaviorRef.current = behavior
    const requestId = ++behaviorRequestRef.current

    const write = async () => {
      // Superseded while queued behind an earlier write — the newest intent
      // writes instead.
      if (requestId !== behaviorRequestRef.current) return

      const setup = setupPromiseRef.current
      if (!setup) {
        // The init effect has not published its promise yet (its `updateOptions`
        // has not run either), so it will apply the intent recorded above.
        return
      }
      try {
        await setup
      } catch {
        // Init failed and reported it — there is no player to configure.
        return
      }

      // Re-check after the await: a newer intent may have arrived meanwhile.
      if (requestId !== behaviorRequestRef.current) return

      const desired = appKilledBehaviorRef.current
      if (appliedKilledBehaviorRef.current === desired) return

      try {
        await TrackPlayer.updateOptions(buildPlayerOptions(desired))
        appliedKilledBehaviorRef.current = desired
      } catch {
        // Best-effort — never let a notification-behaviour failure surface. The
        // native options are now unknown, so force the next call to re-apply.
        appliedKilledBehaviorRef.current = null
      }
    }

    // `write` never rejects (every await is guarded), but chaining the rejection
    // handler too keeps a future edit from breaking the chain for good.
    behaviorWriteChainRef.current = behaviorWriteChainRef.current.then(write, write)
    return behaviorWriteChainRef.current
  }, [])

  // Sync modeRef
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  // Map react-native-track-player state to PlayerState
  useEffect(() => {
    const ps = playbackState.state
    playbackStateRef.current = ps

    if (modeRef.current === 'track') {
      // On-demand mode owns `state` itself (set in playTrack/stopTrack), but a
      // player error must never be swallowed: without this branch a failed
      // HTTP/decoder load of the on-demand track kept the UI at "playing" with
      // no sound and no explanation anywhere.
      if (ps === TrackPlayerState.Error) {
        const errMessage =
          'error' in playbackState && playbackState.error ? playbackState.error.message : null
        setError(errMessage || 'Track playback error')
        setState('error')
      }
      return
    }

    if (ps === TrackPlayerState.Playing) {
      setState('playing')
      setError(null)
      retryCountRef.current = 0
    } else if (ps === TrackPlayerState.Buffering || ps === TrackPlayerState.Loading) {
      setState('buffering')
    } else if (ps === TrackPlayerState.Paused) {
      setState('paused')
    } else if (ps === TrackPlayerState.Error) {
      setState('error')
      setError('Stream playback error')
    } else if (ps === TrackPlayerState.None || ps === TrackPlayerState.Ready) {
      if (isPlayingRef.current) {
        setState('buffering')
      }
    }
  }, [playbackState])

  // Watchdog heartbeat: a changing position is the only evidence that audio is
  // really progressing (the state label can stay "Playing" on a frozen stream).
  useEffect(() => {
    lastProgressAtRef.current = Date.now()
    if (position > 0) progressSeenRef.current = true
  }, [position])

  // Resume playback when returning to the foreground (native only).
  // Some platforms pause the player when the app is backgrounded; if the user
  // intended it to keep playing, nudge it back into the playing state.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appActiveRef.current = nextState === 'active'
      // Rebase the stall watchdog on EVERY transition, not only on the resumed
      // path for an OS-paused player. While backgrounded `useProgress(250)`
      // stops delivering position updates (its self-restarting `setTimeout`
      // poll is frozen/throttled by the OS), so `lastProgressAtRef` is a whole
      // background gap old by the time the app returns. Without an unconditional
      // rebase the first watchdog tick after resume sees a stale baseline while
      // the native state is still Playing (no state event was delivered to the
      // suspended JS thread either), judges the just-resumed stream as stalled,
      // and forces a full reset/add/play reconnect — the audible gap + loading
      // flash this hook is meant to avoid.
      lastProgressAtRef.current = Date.now()
      if (nextState === 'active') {
        // Skip the first watchdog tick after a resume: the interval runs on its
        // own clock and the state re-read below is async, so a tick could run
        // while the view is half-updated.
        resumeGraceUntilRef.current = Date.now() + WATCHDOG_INTERVAL
      }

      if (nextState !== 'active' || !isPlayingRef.current) return
      // Capture the loaded URL before the async re-read: if a station switch
      // starts while we wait, this stale resume must not `play()` the queue that
      // is being replaced.
      const urlAtResume = currentUrlRef.current
      TrackPlayer.getPlaybackState()
        .then((playback) => {
          // `usePlaybackState` fetches once on mount and then relies solely on
          // `Event.PlaybackState`; events emitted while the JS thread was
          // suspended never arrive, so re-seed the ref from the live player.
          // This keeps the watchdog's state check and the slug-change effect's
          // `intendsToPlay` honest right after a resume.
          playbackStateRef.current = playback.state
          if (playback.state === TrackPlayerState.Paused) {
            // A pause/stop that arrived during the async re-read must win: the
            // user's intent (`isPlayingRef`) can flip to false between the
            // handler entry above and this continuation, and resurrecting the
            // transport would override the pause the user just issued. Likewise,
            // a station switch started meanwhile leaves `currentUrlRef` pointing
            // at a different URL, so playing this stale queue would fight the
            // in-flight load.
            if (!isPlayingRef.current || currentUrlRef.current !== urlAtResume) return
            // OS-induced pause on an intent-to-play session: the baseline was
            // just rebased above, so only restart the transport. Playing /
            // Buffering / Loading must not be touched — they are already fine.
            return TrackPlayer.play()
          }
        })
        .catch(() => {})
    })

    return () => subscription.remove()
  }, [])

  // Keep the hook's "the user intends to play" flag in sync with the OS media
  // controls (notification / lock-screen). The playback service
  // (src/services/trackPlayerService.ts) performs the actual transport action;
  // without this, a notification pause/stop would leave `isPlayingRef` true and
  // the stall watchdog would silently "recover" the stream ~15s later.
  useEffect(() => {
    const subscriptions = [
      TrackPlayer.addEventListener(Event.RemotePause, () => {
        isPlayingRef.current = false
        // Cancel any in-flight load: `tryPlay` / `playTrack` await the setup
        // promise before they start audio, and a notification pause issued in
        // that window must not be overwritten by the load they resume with (see
        // `playRequestRef`).
        playRequestRef.current += 1
        // Mirror the intent into the state the slug-change effect also consults
        // (see `intendsToPlay`): the native transport is async, and a station
        // switch issued in the same tick must not read the still-stale `Playing`
        // and start audio the user just paused.
        playbackStateRef.current = TrackPlayerState.Paused
        setState('paused')
        // Paused: the tray must not outlive a kill (see `applyAppKilledBehavior`).
        void applyAppKilledBehavior(AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification)
      }),
      TrackPlayer.addEventListener(Event.RemotePlay, () => {
        isPlayingRef.current = true
        // Rebase the stall watchdog: a notification pause may have lasted
        // longer than STALL_TIMEOUT, and `useProgress(250)` only refreshes the
        // baseline when the position changes (RNTP dedups identical progress).
        // Without this, the first watchdog tick after a resume would see a stale
        // baseline while `playbackStateRef` is already Playing and force a full
        // reset/add/play reconnect — an offline-UI flash for a normal resume.
        lastProgressAtRef.current = Date.now()
        // Playing: the stream must survive a kill (see `applyAppKilledBehavior`).
        void applyAppKilledBehavior(AppKilledPlaybackBehavior.ContinuePlayback)
      }),
      TrackPlayer.addEventListener(Event.RemoteStop, () => {
        isPlayingRef.current = false
        // Same in-flight-load cancellation as RemotePause above.
        playRequestRef.current += 1
        // Same synchronous mirror as RemotePause above.
        playbackStateRef.current = TrackPlayerState.Stopped
        setState('paused')
        // Stopped: same kill-time semantics as a pause.
        void applyAppKilledBehavior(AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification)
      }),
    ]

    return () => subscriptions.forEach((subscription) => subscription.remove())
  }, [applyAppKilledBehavior])

  // Initialize TrackPlayer once.
  //
  // `setupPlayer()` is NOT idempotent. With `ContinuePlayback` the Android
  // playback service (and its process, React instance and TurboModule) survives
  // the app being swiped from recents, so after a relaunch `isServiceBound` is
  // already true and `setupPlayer()` rejects with `player_already_initialized`
  // (MusicModule.kt:191-198). A chain that `await`s it therefore never reached
  // `readyRef = true`, which silently dropped every station switch. Hence the
  // init below probes first AND wraps the `setupPlayer()` call itself, so the
  // "already bound" rejection can never short-circuit the rest of the work.
  //
  // Everything is guarded by `cancelled`: these native calls outlive the
  // component and a dead instance must not keep writing native state or its own
  // refs (and must not issue a second `setupPlayer()`).
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    // Set by the cleanup below. The awaits themselves cannot be aborted, so
    // every continuation past an await re-checks this before touching anything.
    let cancelled = false

    const setupPromise = (async () => {
      // Probe `getPlaybackState()`: it rejects with `player_not_initialized`
      // when THIS module instance has not bound the playback service yet —
      // Android: MusicModule.kt:542-545 calls `verifyServiceBoundOrReject`
      // (MusicModule.kt:100-110); iOS: TrackPlayer.swift:650-653 calls
      // `rejectWhenNotInitialized` (TrackPlayer.swift:86-92) — and resolves with
      // the state bundle once it has. A rejection therefore means "this JS
      // instance is not bound yet", NOT "the native player is uninitialized":
      // with `ContinuePlayback` the service — and the player it already set up —
      // can outlive the app, so the bind may complete between this probe and the
      // `setupPlayer()` call below, and `setupPlayer()` then rejects with
      // `player_already_initialized`. The probe cannot hang: the Android check is
      // synchronous inside `launchInScope` (MusicModule.kt:566-570) and either
      // rejects or reads the live player, so it always settles. It is
      // deliberately NOT matched on the error message string.
      let alreadyInitialized = false
      try {
        await TrackPlayer.getPlaybackState()
        alreadyInitialized = true
      } catch {
        alreadyInitialized = false
      }
      if (cancelled) return

      if (!alreadyInitialized) {
        // Fresh process: the only call that may bind the service.
        try {
          await TrackPlayer.setupPlayer()
        } catch (err) {
          // `setupPlayer()` rejects BOTH for a genuine bind failure and for the
          // lost race described above (`player_already_initialized`). Probe
          // again: a resolving player means it was the race, so initialization
          // must continue; only a second rejection proves the player really is
          // unavailable, and then the error is propagated.
          try {
            await TrackPlayer.getPlaybackState()
          } catch {
            throw err
          }
        }
        if (cancelled) return
      }

      // Everything below runs on BOTH paths. That is guaranteed by the
      // `try/catch` around `setupPlayer()` above (not by the probe alone): the
      // only ways out of this IIFE before `readyRef = true` are a setup failure
      // that a second probe confirmed is real, or the component unmounting
      // (`cancelled`), where a dead instance has nothing left to set up.

      // Notification / lock-screen controls. The advertised capabilities mirror
      // the events handled by src/services/trackPlayerService.ts exactly:
      // Play/Pause, Stop and SkipToNext/SkipToPrevious (RemoteNext/
      // RemotePrevious). `notificationCapabilities` is the v5 replacement for
      // the v3 `compactCapabilities`.
      try {
        const behavior = appKilledBehaviorRef.current
        await TrackPlayer.updateOptions(buildPlayerOptions(behavior))
        appliedKilledBehaviorRef.current = behavior
      } catch {
        // Best-effort: a failed updateOptions must not block playback setup.
      }
      if (cancelled) return

      try {
        const savedVol = await storage.getItem(STORAGE_KEYS.VOLUME)
        if (cancelled) return
        const savedMuted = await storage.getItem(STORAGE_KEYS.MUTED)
        if (cancelled) return
        if (savedVol !== null) {
          const v = parseFloat(savedVol)
          if (!isNaN(v) && v >= 0 && v <= 1) {
            setVolumeState(v)
            await TrackPlayer.setVolume(v)
            if (cancelled) return
            prevVolumeRef.current = v
          }
        }
        if (savedMuted === 'true') {
          setMuted(true)
          await TrackPlayer.setVolume(0)
          if (cancelled) return
        }
      } catch {
        // Best-effort: a failed volume restore must not block playback setup.
      }
      if (cancelled) return

      readyRef.current = true

      // Seed the JS-side bookkeeping from the native player itself.
      //
      // This JS instance starts with no memory of a session that outlived it:
      // with `AppKilledPlaybackBehavior.ContinuePlayback` the Android playback
      // service keeps the player alive after the app is swiped away, so on
      // relaunch RNTP can already be Playing (or Paused) while `isPlayingRef` is
      // still false. Without the seed a station switch was silently dropped (see
      // the slug-change effect) and the stall watchdog / reconnect chain stayed
      // disarmed for the whole session.
      try {
        const playback = await TrackPlayer.getPlaybackState()
        if (cancelled) return
        // `hasQueueRef` / `currentUrlRef` are restored REGARDLESS of the
        // playback state: a paused session still owns a queue with a loaded URL,
        // and the tray now-playing must still be able to publish after a
        // relaunch onto it (otherwise it stays stuck on the fallback title).
        const [active, activeIndex] = await Promise.all([
          TrackPlayer.getActiveTrack(),
          TrackPlayer.getActiveTrackIndex(),
        ])
        if (cancelled) return
        if (activeIndex !== undefined || active?.url) hasQueueRef.current = true
        // Record which stream is already loaded: the persisted station slug
        // commonly resolves a few ms after the mount, and if it points at the
        // stream that is already on air, re-loading it would be a pointless
        // (and audible) teardown.
        if (active?.url) currentUrlRef.current = active.url

        // Arm the JS-side "intent" ONLY when no explicit play/pause intent has
        // been registered while this seed was in flight. Otherwise a user action
        // taken during a cold start (play tapped before the probe finished, or a
        // notification pause during a relaunch) would be clobbered by the
        // inherited state. `behaviorRequestRef` is the marker for "an explicit
        // intent already happened" — every `applyAppKilledBehavior` call bumps
        // it — and once the user has spoken, the inherited native state must not
        // be allowed to arm anything on their behalf.
        if (behaviorRequestRef.current === 0) {
          if (
            modeRef.current === 'radio' &&
            (playback.state === TrackPlayerState.Playing ||
              playback.state === TrackPlayerState.Buffering)
          ) {
            // `isPlayingRef` is armed ONLY for an actually-playing session — a
            // paused/idle player must never look like "the user intends to
            // play", or a mount would auto-start audio.
            isPlayingRef.current = true
          } else if (modeRef.current === 'radio' && playback.state === TrackPlayerState.Paused) {
            // The session this JS instance inherited is paused: arm the
            // kill-time notification removal for it. Fire-and-forget —
            // `applyAppKilledBehavior` chains on `setupPromiseRef`, which is
            // this very promise, so awaiting it here would deadlock.
            void applyAppKilledBehavior(
              AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
            )
          }
        }
      } catch {
        // Best-effort: a failed state probe must not block setup.
      }
    })().catch((err: unknown) => {
      // A genuine failure (native player unavailable) is surfaced instead of
      // silently leaving the hook permanently un-ready. Note the deliberate
      // asymmetry: the "service already bound" case above is handled, not
      // caught. Nothing is reported for a cancelled run — the instance is gone.
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Player initialization error')
      setState('error')
    })
    setupPromiseRef.current = setupPromise

    return () => {
      // The in-flight init must not keep writing native state or this (dead)
      // instance's refs. In particular a remount would otherwise race a second
      // `setupPlayer()` against this one, and `MusicModule.playerSetUpPromise`
      // (MusicModule.kt:202) is a single field: the loser's promise is
      // overwritten and may never settle.
      cancelled = true
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Publish the latest now-playing metadata to the OS tray/lock-screen.
   *
   * On native the tray is owned by react-native-track-player (on web the Media
   * Session API does the same job — see useAudioPlayer.web.ts). `setNowPlaying`
   * only records the desired values; this function is what actually pushes
   * them, so it can also be re-run right after a track is added to the queue (a
   * status update that arrived before the first `play()` must not be lost).
   *
   * Best-effort by design: a missing queue or a rejected native call must never
   * interrupt playback.
   */
  const publishNowPlaying = useCallback(async () => {
    try {
      // Never touch TrackPlayer before setupPlayer() resolves.
      if (setupPromiseRef.current) await setupPromiseRef.current
      if (!readyRef.current || !hasQueueRef.current) return
      // On-demand mode owns its tray metadata (`TrackPlayer.add` in `playTrack`);
      // a radio status update must not overwrite it.
      if (modeRef.current === 'track') return

      // Read the desired values AFTER the await: a newer status may have
      // arrived while waiting for setup. The WS can also repeat the same track
      // many times, so skip no-op updates entirely.
      const meta = nowPlayingRef.current
      const published = publishedNowPlayingRef.current
      if (published && published.title === meta.title && published.artist === meta.artist) return

      await TrackPlayer.updateNowPlayingMetadata({
        title: meta.title,
        artist: meta.artist,
        artwork: getArtworkUri(),
      })
      publishedNowPlayingRef.current = { ...meta }
    } catch {
      // Best-effort — a metadata failure must not break playback.
    }
  }, [])

  const tryPlay = useCallback(
    async (url: string, reason: TryPlayReason) => {
      // Invalidate any in-flight request: this one is now the newest.
      const requestId = ++playRequestRef.current
      // Playing intent: a kill must not stop the stream (see
      // `applyAppKilledBehavior`). Covers `play()`, `stopTrack()`, the retry
      // timer and the slug-change effect, which all funnel through here.
      void applyAppKilledBehavior(AppKilledPlaybackBehavior.ContinuePlayback)
      try {
        // Never touch TrackPlayer before setupPlayer() resolves.
        if (setupPromiseRef.current) await setupPromiseRef.current
        if (requestId !== playRequestRef.current) return

        // Fast path: if the stream this call asks for is ALREADY loaded and
        // healthy, reset/add/play would only destroy and rebuild the native
        // decoder (audible gap + loading flash) for no gain. This is what a
        // resumed / already-playing stream hits. The probe is only attempted
        // when it can possibly apply, and any probe failure falls through to the
        // destructive load below (the safe default).
        //
        // The automatic retry (`reason === 'reconnect'`) is deliberately EXCLUDED:
        // it is only armed after an explicit failure (error state / stall
        // watchdog), so the loaded queue must be assumed unhealthy. A
        // dead-but-open stream that RNTP still reports as Playing would
        // otherwise be fast-pathed forever and never rebuilt — breaking the
        // stall recovery this hook guarantees.
        if (reason !== 'reconnect' && currentUrlRef.current === url && hasQueueRef.current) {
          let nativeState: TrackPlayerState | undefined
          let activeUrl: string | undefined
          try {
            const [playback, active] = await Promise.all([
              TrackPlayer.getPlaybackState(),
              TrackPlayer.getActiveTrack(),
            ])
            nativeState = playback.state
            activeUrl = active?.url
          } catch {
            // Probe unavailable — fall through to the destructive path.
          }
          if (requestId !== playRequestRef.current) return

          const isLoadedAndHealthy =
            activeUrl === url &&
            (nativeState === TrackPlayerState.Playing ||
              nativeState === TrackPlayerState.Buffering ||
              nativeState === TrackPlayerState.Paused)

          if (isLoadedAndHealthy) {
            // Re-assert the play intent without touching the queue. The queue /
            // tray are intact (`reset()` is skipped), so `hasQueueRef` and
            // `publishedNowPlayingRef` are deliberately left as they are.
            currentUrlRef.current = url
            isPlayingRef.current = true
            playbackStateRef.current = nativeState

            if (nativeState === TrackPlayerState.Paused) {
              // Only the transport action was missing; resume the loaded
              // stream. This is a genuine fresh playback segment, so it gets a
              // full stall budget and its own progress evidence.
              lastProgressAtRef.current = Date.now()
              progressSeenRef.current = false
              await TrackPlayer.play()
              if (requestId !== playRequestRef.current) return
              setState('playing')
            } else {
              // Already playing/buffering: leave the watchdog baseline and
              // `progressSeenRef` untouched so a genuinely frozen stream stays
              // detectable (the watchdog recovers it via a destructive retry).
              setState(nativeState === TrackPlayerState.Buffering ? 'buffering' : 'playing')
            }
            return
          }
        }

        currentUrlRef.current = url
        isPlayingRef.current = true
        // A fresh attempt gets a full stall budget and its own progress evidence.
        lastProgressAtRef.current = Date.now()
        progressSeenRef.current = false
        setState('loading')

        await TrackPlayer.reset()
        if (requestId !== playRequestRef.current) return
        await TrackPlayer.add({
          id: url,
          url,
          title: NOW_PLAYING_FALLBACK,
          artist: NOW_PLAYING_FALLBACK,
          artwork: getArtworkUri(),
        })
        if (requestId !== playRequestRef.current) return
        hasQueueRef.current = true
        // `reset()` + `add()` above cleared the tray back to the fallback, so
        // the dedup cache must be invalidated or the real metadata (unchanged
        // since the previous load) would never be restored.
        publishedNowPlayingRef.current = null
        // A now-playing update that arrived before the first play must not be
        // lost: publish the latest known metadata now that a queue exists.
        void publishNowPlaying()
        await TrackPlayer.play()
      } catch (err: any) {
        if (requestId !== playRequestRef.current) return
        setError(err.message || 'Playback error')
        setState('error')
      }
    },
    [publishNowPlaying, applyAppKilledBehavior],
  )

  const play = useCallback(async () => {
    retryCountRef.current = 0
    setError(null)

    // In on-demand mode `play` must restart the CURRENT track, not the radio
    // stream: `mode`/`currentTrack` — and the PlayerBar + tray metadata that
    // `playTrack` published — describe the track, so starting radio underneath
    // them would desync the UI from the audio. This is also the user-facing
    // recovery for a failed track load: `playTrack` reports `error` but arms no
    // automatic retry (unlike the radio path).
    if (modeRef.current === 'track' && currentTrack) {
      await playTrackRef.current(currentTrack)
      return
    }

    const slug = currentSlug || 'main'
    savedSlugRef.current = slug
    const url = buildStreamUrl(slug)
    await tryPlay(url, 'user-play')
  }, [currentSlug, buildStreamUrl, tryPlay, currentTrack])

  const pause = useCallback(async () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    // Cancel any in-flight load. `tryPlay()` waits for `setupPlayer()` before it
    // resets/adds/plays, and `playTrack()` does the same; without this bump a
    // pause issued during that window was overwritten by the resumed load (which
    // re-armed `isPlayingRef` and started audio). The old deferred-play flush
    // re-checked `isPlayingRef` for exactly this reason — the `requestId` guards
    // already present in `tryPlay`/`playTrack` are the equivalent here.
    playRequestRef.current += 1
    isPlayingRef.current = false
    // Mirror the intent synchronously into the state the slug-change effect also
    // consults (see `intendsToPlay`): `TrackPlayer.pause()` and its
    // PlaybackState event are async, and a station switch issued in the same tick
    // must not read the still-stale `Playing` and auto-start audio the user just
    // paused.
    playbackStateRef.current = TrackPlayerState.Paused
    // Paused: killing the app must remove the tray instead of leaving a dead
    // notification behind (see `applyAppKilledBehavior`).
    void applyAppKilledBehavior(AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification)
    await TrackPlayer.pause()
    setState('paused')
  }, [applyAppKilledBehavior])

  const toggle = useCallback(async () => {
    if (state === 'playing' || state === 'loading' || state === 'buffering' || state === 'reconnecting') {
      await pause()
    } else {
      await play()
    }
  }, [state, play, pause])

  const playTrack = useCallback(async (track: OnDemandTrack) => {
    // Switch the mode SYNCHRONOUSLY, before any await. The reconnect loop, the
    // buffering watchdog and the slug effect are all gated on
    // `modeRef.current === 'track'`; `setMode()` alone only updates the ref one
    // render later, leaving a window where `reset()` below looks like a dying
    // radio stream and gets answered with a radio retry.
    setMode('track')
    modeRef.current = 'track'

    // A backoff timer scheduled while the radio stream was down must not
    // resurrect the radio source on top of the on-demand track.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    setError(null)
    retryCountRef.current = 0
    // After an on-demand track, switching substation must switch the stream back
    // to radio — the slug-change effect handles that via `prevSlugRef` +
    // `intendsToPlay` (`isPlayingRef` is set below, before any await).
    savedSlugRef.current = currentSlug || 'main'
    setCurrentTrack(track)
    setState('loading')
    // Playing intent: a kill must not stop the on-demand track either.
    void applyAppKilledBehavior(AppKilledPlaybackBehavior.ContinuePlayback)

    const url = getTrackStreamUrl(track.id)
    currentUrlRef.current = url
    isPlayingRef.current = true

    const requestId = ++playRequestRef.current
    try {
      // Same discipline as `tryPlay`: on a cold start `setupPlayer()` has not
      // resolved yet and `reset()` would reject with "The player is not
      // initialized. Call setupPlayer first." — which used to be swallowed into
      // an `error` state, so nothing ever played. Wait for setup, don't fail.
      if (setupPromiseRef.current) await setupPromiseRef.current
      if (requestId !== playRequestRef.current) return

      await TrackPlayer.reset()
      if (requestId !== playRequestRef.current) return
      await TrackPlayer.add({
        id: track.id,
        url,
        title: track.title,
        artist: track.artist || undefined,
        duration: track.duration || undefined,
        // Tracks have no artwork of their own — fall back to the app logo.
        artwork: getArtworkUri(),
      })
      if (requestId !== playRequestRef.current) return
      hasQueueRef.current = true
      await TrackPlayer.play()
      if (requestId !== playRequestRef.current) return
      setState('playing')
    } catch (err: any) {
      if (requestId !== playRequestRef.current) return
      setError(err.message || 'Track playback error')
      setState('error')
    }
  }, [currentSlug, applyAppKilledBehavior])

  // Publish the current `playTrack` to `play()` (declared earlier).
  playTrackRef.current = playTrack

  const stopTrack = useCallback(async () => {
    setMode('radio')
    // Synchronous, so the radio-only effects below see the switch immediately
    // instead of one render later (same reasoning as `playTrack`).
    modeRef.current = 'radio'
    setCurrentTrack(null)
    setError(null)
    retryCountRef.current = 0

    const slug = savedSlugRef.current
    const url = buildStreamUrl(slug)
    await tryPlay(url, 'stop-track')
  }, [buildStreamUrl, tryPlay])

  // When track ends, return to radio
  useEffect(() => {
    if (modeRef.current === 'track' && playbackState.state === TrackPlayerState.Ended) {
      stopTrack()
    }
  }, [playbackState.state, stopTrack])

  const setVolume = useCallback(async (v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    await TrackPlayer.setVolume(clamped)
    if (clamped > 0) {
      setMuted(false)
      prevVolumeRef.current = clamped
    }
    // Persistence is debounced by VolumeSlider (owns the high-frequency events).
  }, [])

  const toggleMute = useCallback(async () => {
    const newMuted = !muted
    const newVolume = newMuted ? 0 : prevVolumeRef.current || 1
    setMuted(newMuted)
    setVolumeState(newVolume)
    await TrackPlayer.setVolume(newMuted ? 0 : newVolume)
    storage.setItem(STORAGE_KEYS.MUTED, String(newMuted))
  }, [muted])

  // Feed now-playing metadata into the OS tray/lock-screen. The stream status
  // arrives over WebSocket (`app/index.tsx` watches `status.trackTitle` /
  // `status.trackArtist`); react-native-track-player owns the system controls
  // and is the only way to display it on native. Same platform-agnostic API as
  // the web hook, which implements this with the Media Session API.
  const setNowPlaying = useCallback(
    (meta: NowPlayingMeta) => {
      // `trackTitle`/`trackArtist` arrive over the WebSocket (untrusted), so
      // control characters are stripped and the length is capped before they
      // reach the Android notification. Fall back to the app name so the tray
      // card is never blank (idle / live without metadata).
      nowPlayingRef.current = {
        title: sanitizeMediaText(meta.title) ?? NOW_PLAYING_FALLBACK,
        artist: sanitizeMediaText(meta.artist) ?? NOW_PLAYING_FALLBACK,
      }
      void publishNowPlaying()
    },
    [publishNowPlaying],
  )

  // Reconnect on error with exponential backoff
  useEffect(() => {
    if (modeRef.current === 'track') return
    if (state === 'error' && isPlayingRef.current) {
      const delay = Math.min(2000 * Math.pow(2, retryCountRef.current), MAX_RETRY_DELAY)
      retryCountRef.current += 1

      retryTimerRef.current = setTimeout(() => {
        const slug = currentSlug || 'main'
        const url = buildStreamUrl(slug)
        tryPlay(url, 'reconnect')
      }, delay)

      if (retryCountRef.current > 3) {
        setState('reconnecting')
      }
    }
  }, [state, currentSlug, buildStreamUrl, tryPlay])

  // Safety net: buffering timeout
  useEffect(() => {
    if (state !== 'buffering' || modeRef.current === 'track') return
    const timer = setTimeout(() => setState('error'), 10_000)
    return () => clearTimeout(timer)
  }, [state])

  // Stall watchdog (radio mode). The reconnect effect above only fires on an
  // explicit `state === 'error'`; the buffering net only on `state ===
  // 'buffering'`. A stream that goes silent without either state — an
  // unintended Pause (audio-focus loss, OS/decoder hiccup) or a frozen position
  // while RNTP still reports Playing — has no escalation and stays silent until
  // the app is restarted. Keep retrying while the user intends to play.
  //
  // Deliberately conservative to avoid churn on streams that never report a
  // position: escalate only after STALL_TIMEOUT of no progress AND (position
  // advanced at some point for this load, or RNTP explicitly says Paused).
  // Setting `state = 'error'` funnels into the existing backoff chain above
  // rather than arming a second, competing timer.
  useEffect(() => {
    const id = setInterval(() => {
      if (!isPlayingRef.current || modeRef.current === 'track') return
      if (!appActiveRef.current) return
      if (retryTimerRef.current) return
      // Grace window right after a foreground resume (see the AppState handler):
      // the resumed stream has not had a chance to report progress again, and
      // the native state re-read there is async. Skip the first tick.
      if (Date.now() < resumeGraceUntilRef.current) return

      if (Date.now() - lastProgressAtRef.current <= STALL_TIMEOUT) return

      const ps = playbackStateRef.current
      if (ps !== TrackPlayerState.Paused && !progressSeenRef.current) return

      setError('Stream stalled — reconnecting...')
      setState('error')
    }, WATCHDOG_INTERVAL)
    return () => clearInterval(id)
  }, [])

  /**
   * Whether the app should be producing audio right now — the question the
   * slug-change effect must answer before it may replace the current stream.
   *
   * `isPlayingRef` is the *intent* flag: `play()`/`pause()`, `playTrack()` and
   * the OS media controls keep it current, and it is seeded from the real RNTP
   * state on mount. The live RNTP state is accepted as a secondary signal on
   * purpose — it is the source of truth, and it closes every window in which the
   * JS-side flag is stale (a switch fired before the mount seed landed, a session
   * that outlived the app, a state event that never reached a suspended JS
   * thread).
   *
   * Widening the predicate this way cannot auto-start audio on a genuinely
   * paused/idle player: Playing/Buffering/Loading mean audio is already being
   * produced or requested by someone, so there is nothing to start. `pause()` and
   * the RemotePause/RemoteStop handlers mirror the paused intent into
   * `playbackStateRef` synchronously, so even a switch issued in the same tick as
   * a pause is still treated as paused.
   */
  const intendsToPlay = useCallback(() => {
    if (isPlayingRef.current) return true
    const ps = playbackStateRef.current
    return (
      ps === TrackPlayerState.Playing ||
      ps === TrackPlayerState.Buffering ||
      ps === TrackPlayerState.Loading
    )
  }, [])

  // React to slug changes (station switch).
  // - The mount is NOT a change: `prevSlugRef` is seeded with the initial slug,
  //   so a cold start never auto-starts playback.
  // - A real change while the app intends to play switches the stream
  //   unconditionally — the same shape the web hook has always used, and the only
  //   shape that works when the switch is a hot one (no pause in between).
  // - A real change while the player is intentionally paused/idle only records
  //   the new URL, so the next `play()` starts the newly selected station.
  // - No `readyRef` gate here: `tryPlay` already awaits `setupPromiseRef`, so a
  //   switch issued before setup resolves is queued behind it instead of being
  //   silently dropped (the old `pendingPlayRef` deferral only ever flushed from
  //   the init chain and turned the "already initialized" rejection into a
  //   permanent, invisible loss of every station switch).
  useEffect(() => {
    if (modeRef.current === 'track') return

    const slug = currentSlug || 'main'
    const url = buildStreamUrl(slug)
    // Remember the selection: a later `play()` / `stopTrack()` must use it.
    savedSlugRef.current = slug

    if (prevSlugRef.current === slug) return
    prevSlugRef.current = slug

    retryCountRef.current = 0
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    if (!intendsToPlay()) return

    // This URL is already what we (or the session that outlived this JS instance)
    // loaded — nothing to switch. Without this, a relaunch that resolves the
    // persisted slug after the mount would re-load the very stream that is on air.
    if (currentUrlRef.current === url) return

    // `tryPlay` awaits setup itself, so no pre-setup deferral is needed.
    void tryPlay(url, 'slug-change')
  }, [currentSlug, buildStreamUrl, tryPlay, intendsToPlay])

  return {
    play,
    pause,
    toggle,
    state,
    error,
    volume,
    setVolume,
    muted,
    toggleMute,
    mode,
    currentTrack,
    trackProgress,
    playTrack,
    stopTrack,
    position,
    duration,
    setNowPlaying,
  }
}
