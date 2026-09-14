import { useEffect } from 'react'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

const WAKE_LOCK_TAG = 'raw-radio-playback'

/**
 * Keeps the screen awake while `isActive` is true.
 * Releases the lock when `isActive` becomes false or on unmount.
 * Errors (e.g. unsupported web browsers) are swallowed silently.
 */
export function useWakeLock(isActive: boolean): void {
  useEffect(() => {
    if (isActive) {
      activateKeepAwakeAsync(WAKE_LOCK_TAG).catch(() => {})
    } else {
      deactivateKeepAwake(WAKE_LOCK_TAG).catch(() => {})
    }

    return () => {
      deactivateKeepAwake(WAKE_LOCK_TAG).catch(() => {})
    }
  }, [isActive])
}
