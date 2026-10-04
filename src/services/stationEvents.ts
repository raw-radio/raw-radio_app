import { storage, STORAGE_KEYS } from '../hooks/useStorage'
import type { SubstationInfo } from '../types'

/**
 * Shared, dependency-free bridge between the react-native-track-player playback
 * service (headless JS, no React) and the UI hooks.
 *
 * This module MUST NOT import react-native-track-player: `useSubstations` /
 * `useAudioPlayer` import it, and the web bundle resolves those hooks to their
 * `.web.ts` variants — a RNTP import here would drag shaka-player into the web
 * build. The RNTP calls live in `stationSwitcher.ts`, which only the native
 * playback service pulls in.
 *
 * Persisted shape:
 *   STORAGE_KEYS.SUBSTATIONS — JSON array of the currently active stations,
 *                              written by `useSubstations` after every fetch.
 *   STORAGE_KEYS.SUBSTATION  — the selected station slug (shared with the UI).
 */

export interface StationSwitchEvent {
  slug: string
  url: string
}

type StationSwitchListener = (event: StationSwitchEvent) => void

const listeners = new Set<StationSwitchListener>()

/** Subscribe to station switches made outside React (notification prev/next). */
export function subscribeStationSwitch(listener: StationSwitchListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Notify React consumers that the active station changed. Never throws. */
export function emitStationSwitch(event: StationSwitchEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // A broken listener must never abort the station switch.
    }
  }
}

function isSubstationInfo(value: unknown): value is SubstationInfo {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { slug?: unknown }).slug === 'string' &&
    ((value as { slug: string }).slug.length > 0)
  )
}

/** Reads the persisted active-station list. Returns `[]` when absent/corrupt. */
export async function readStoredStations(): Promise<SubstationInfo[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEYS.SUBSTATIONS)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSubstationInfo)
  } catch {
    return []
  }
}

/** Persists the active-station list so the headless service can switch offline. */
export async function writeStoredStations(stations: SubstationInfo[]): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEYS.SUBSTATIONS, JSON.stringify(stations))
  } catch {
    // Storage unavailable — non-fatal, the next successful fetch retries.
  }
}

export function readCurrentSlug(): Promise<string | null> {
  return storage.getItem(STORAGE_KEYS.SUBSTATION)
}

export function writeCurrentSlug(slug: string): Promise<void> {
  return storage.setItem(STORAGE_KEYS.SUBSTATION, slug)
}
