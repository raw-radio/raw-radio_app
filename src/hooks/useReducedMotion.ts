import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/**
 * Tracks the OS/browser "reduce motion" preference.
 *
 * Mirrors the `@media (prefers-reduced-motion: reduce)` guard used by the web
 * player (`web/src/styles/player.scss`): when the user prefers reduced motion,
 * every decorative animation (pulse rings, connection dot, card icon, indicator
 * glow) is disabled while the static styles stay intact.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    let mounted = true

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled)
      })
      .catch(() => {
        // Preference is unavailable on this platform — keep animations enabled.
      })

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (mounted) setReducedMotion(enabled)
    })

    return () => {
      mounted = false
      subscription?.remove?.()
    }
  }, [])

  return reducedMotion
}
