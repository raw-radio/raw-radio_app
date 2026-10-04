import { useEffect, useRef, useState } from 'react'
import { AppState, Platform, type AppStateStatus } from 'react-native'
import { checkForUpdate } from '../services/appUpdate'
import type { AppUpdateInfo } from '../types'

/**
 * Minimum spacing between two GitHub release checks.
 *
 * The unauthenticated Releases API allows 60 requests/hour per IP, so a focus
 * handler that fired on every foreground transition would quickly exhaust the
 * quota and silently starve the check (403 → `null`, no affordance). A user
 * foregrounding the app many times within this window keeps the last result.
 */
export const UPDATE_CHECK_MIN_INTERVAL_MS = 5 * 60_000

/**
 * Resolves the newest sideloaded Android build, re-checking whenever the app
 * returns to the foreground.
 *
 * The problem this solves: a build published while the app is already running
 * would otherwise stay invisible until a full process restart, because the
 * first implementation checked exactly once on mount. Here the mount check is
 * kept (so a cold start still resolves fast) and an {@link AppState} listener
 * re-runs it on every `'active'` transition.
 *
 * Deduplication is two-fold:
 * - time-based — a check is skipped if one ran less than
 *   {@link UPDATE_CHECK_MIN_INTERVAL_MS} ago (follows GitHub's rate limit);
 * - in-flight — overlapping `'active'` events (or a focus that races the mount
 *   check) never start a second concurrent request.
 *
 * `checkForUpdate` resolves to `null` on every failure mode and is a no-op on
 * web, so a failed check only ever means "no affordance", never an error
 * surface. The returned value is the latest successful result (or `null`).
 */
export function useAppUpdateCheck(): AppUpdateInfo | null {
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  /** Epoch ms of the last started check; `0` = never (mount always passes). */
  const lastCheckAtRef = useRef(0)
  /** Guards against overlapping requests from rapid focus events. */
  const inFlightRef = useRef(false)

  useEffect(() => {
    // Android-only affordance; the listener would be harmless on web but the
    // check itself is the web no-op, so skip the subscription entirely.
    if (Platform.OS !== 'android') return

    let cancelled = false

    const runCheck = () => {
      if (inFlightRef.current) return
      const now = Date.now()
      if (now - lastCheckAtRef.current < UPDATE_CHECK_MIN_INTERVAL_MS) return

      lastCheckAtRef.current = now
      inFlightRef.current = true
      void checkForUpdate()
        .then((info) => {
          if (!cancelled) setUpdateInfo(info)
        })
        .catch(() => {
          // Defensive: the service is implemented to never reject.
        })
        .finally(() => {
          inFlightRef.current = false
        })
    }

    // First check on mount, then on every return to the foreground.
    runCheck()

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') runCheck()
    }
    const subscription = AppState.addEventListener('change', handleAppStateChange)

    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [])

  return updateInfo
}
