import { useState, useEffect, useCallback } from 'react'
import { AppState } from 'react-native'
import {
  readCurrentSlug,
  readStoredStations,
  subscribeStationSwitch,
  writeCurrentSlug,
  writeStoredStations,
} from '../services/stationEvents'
import type { SubstationInfo } from '../types'

export type { SubstationInfo }

export function useSubstations() {
  const [substations, setSubstations] = useState<SubstationInfo[]>([])
  const [currentSlug, setCurrentSlug] = useState<string>('main')
  const [loading, setLoading] = useState(true)

  // Sync with switches initiated outside React — the playback service handles
  // the notification's Previous/Next buttons and emits this event.
  useEffect(() => {
    return subscribeStationSwitch((event) => {
      setCurrentSlug(event.slug)
    })
  }, [])

  // A switch may also happen while this hook's JS context is suspended (the
  // headless playback service). Re-read the persisted selection on foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      readCurrentSlug().then((saved) => {
        if (saved) setCurrentSlug((prev) => (prev === saved ? prev : saved))
      })
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    readCurrentSlug().then((saved) => {
      if (saved) setCurrentSlug(saved)
    })
    // Prime from the cached list first, so the station grid still renders and
    // the headless switcher has stations to cycle over on an offline cold start.
    readStoredStations().then((stored) => {
      if (stored.length > 0) setSubstations((prev) => (prev.length === 0 ? stored : prev))
    })

    fetch(`${process.env.EXPO_PUBLIC_API_URL || ''}/api/v1/substations`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const active = data.data.filter((s: SubstationInfo) => s.isActive)
          setSubstations(active)
          // Persist for the headless playback service (notification prev/next).
          void writeStoredStations(active)
          readCurrentSlug().then((saved) => {
            if (!active.find((s: SubstationInfo) => s.slug === saved) && active.length > 0) {
              const first = active[0].slug
              setCurrentSlug(first)
              void writeCurrentSlug(first)
            }
          })
        }
      })
      .catch(() => {
        // Offline: keep the cached list; only fall back to `main` if nothing was
        // ever cached (fresh install with no network).
        setSubstations((prev) =>
          prev.length > 0
            ? prev
            : [
                {
                  id: 'main',
                  name: 'Main',
                  icon: 'radio',
                  slug: 'main',
                  color: '#2ECC71',
                  isActive: true,
                },
              ],
        )
      })
      .finally(() => setLoading(false))
  }, [])

  const selectSubstation = useCallback((slug: string) => {
    setCurrentSlug(slug)
    void writeCurrentSlug(slug)
  }, [])

  const currentSubstation = substations.find((s) => s.slug === currentSlug) || substations[0]

  return { substations, currentSlug, currentSubstation, selectSubstation, loading }
}
