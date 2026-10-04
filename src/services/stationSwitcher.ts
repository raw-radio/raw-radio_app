import TrackPlayer from 'react-native-track-player'
import {
  emitStationSwitch,
  readCurrentSlug,
  readStoredStations,
  writeCurrentSlug,
} from './stationEvents'
import { getArtworkUri } from '../utils/artwork'

/**
 * Station switching for the react-native-track-player playback service.
 *
 * The media notification's Previous / Next buttons arrive in the headless
 * playback service (`src/services/trackPlayerService.ts`), which has no access
 * to React state. There is only ever one item in the RNTP queue (a live stream
 * has no "next track"), so `skipToNext()` / `skipToPrevious()` are no-ops. This
 * module implements the intended UX instead: cycle through the persisted
 * station list with wraparound.
 */

// Fallback label so the notification / lock-screen card is never blank while the
// new station's now-playing metadata is still loading over the WebSocket.
const FALLBACK_TITLE = 'RAW Radio'

export type SwitchDirection = 1 | -1

export function buildStreamUrl(slug: string): string {
  const base = process.env.EXPO_PUBLIC_API_URL || ''
  return `${base}/${slug}.mp3`
}

/**
 * Slug reached by moving `direction` steps from `current`, wrapping around:
 * previous on the first station → last; next on the last → first; otherwise the
 * neighbour. Returns `null` when there is nothing to switch to.
 *
 * Pure and side-effect free so the wraparound rule is easy to reason about.
 */
export function nextStationSlug(
  stations: { slug: string }[],
  current: string | null,
  direction: SwitchDirection,
): string | null {
  if (stations.length === 0) return null
  const length = stations.length
  const index = current ? stations.findIndex((s) => s.slug === current) : -1

  // Unknown / unset current slug: start from the first station (next) or the
  // last (previous), which keeps the wraparound semantics intuitive.
  if (index === -1) {
    return direction === 1 ? stations[0].slug : stations[length - 1].slug
  }

  const target = ((index + direction) % length + length) % length
  return stations[target].slug
}

// A switch is an async teardown/rebuild of the native queue; overlapping taps
// (fast double-press) must not interleave `reset()`/`add()` calls.
let switching = false

/**
 * Switches to the previous/next station with wraparound and persists the new
 * selection. Safe to call from the headless JS context: it only touches
 * AsyncStorage and TrackPlayer.
 *
 * Best-effort and never throws — a failed switch must not crash the playback
 * service. Returns the new slug when a switch happened, `null` otherwise.
 */
export async function switchStation(direction: SwitchDirection): Promise<string | null> {
  if (switching) return null

  let stations: Awaited<ReturnType<typeof readStoredStations>>
  let current: string | null
  try {
    stations = await readStoredStations()
    current = await readCurrentSlug()
  } catch {
    return null
  }

  // A single station has no neighbours to cycle to.
  if (stations.length < 2) return null

  const slug = nextStationSlug(stations, current, direction)
  if (!slug || slug === current) return null

  switching = true
  try {
    const url = buildStreamUrl(slug)

    await TrackPlayer.reset()
    await TrackPlayer.add({
      id: url,
      url,
      title: FALLBACK_TITLE,
      artist: FALLBACK_TITLE,
      artwork: getArtworkUri(),
    })
    // The queue was just rebuilt, so re-assert the tray card before playback.
    await TrackPlayer.updateNowPlayingMetadata({
      title: FALLBACK_TITLE,
      artist: FALLBACK_TITLE,
      artwork: getArtworkUri(),
    })
    await TrackPlayer.play()

    await writeCurrentSlug(slug)
    emitStationSwitch({ slug, url })
    return slug
  } catch {
    // The stream may end up not playing (network etc.); the UI retry/watchdog
    // on the native side is out of scope for a headless notification action.
    return null
  } finally {
    switching = false
  }
}
