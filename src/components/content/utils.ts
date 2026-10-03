import { Linking, Platform } from 'react-native'
import * as Clipboard from 'expo-clipboard'

/** Public API origin; empty on web (same-origin) and set to the host on Android. */
const API_BASE = process.env.EXPO_PUBLIC_API_URL || ''

/**
 * Prefix relative server paths (e.g. `/api/v1/content/images/<uuid>`) with the
 * API base so they resolve on native, where a bare `/…` is not a valid URL.
 * Absolute URLs are returned untouched. Mirrors `resolveImageUrl` in
 * `app/src/components/ChatSheet.tsx`.
 */
export function resolveImageUrl(path: string, apiBase: string = API_BASE): string {
  return path.startsWith('http') ? path : `${apiBase}${path}`
}

/**
 * Opens a URL outside the app. `Linking.openURL` covers native; on web we go
 * through the DOM so `mailto:` stays in-page instead of spawning a blank tab.
 * Mirrors the `openExternal` helper in `app/app/copyright.tsx`.
 */
export function openExternal(url: string): void {
  if (!url) return

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return
    if (url.startsWith('mailto:')) {
      window.location.href = url
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    return
  }

  void Linking.openURL(url).catch(() => {
    // No app registered for this scheme — nothing else we can do.
  })
}

/**
 * Best-effort clipboard copy. Uses `expo-clipboard` on every platform (it wraps
 * `navigator.clipboard` on web) and resolves to `false` rather than throwing so
 * callers can show an inline "не удалось" state without an error boundary.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await Clipboard.setStringAsync(text)
    return true
  } catch {
    return false
  }
}

/** Formats a money amount using the page locale, tolerating a missing currency. */
export function formatMoney(value: number, currency?: string): string {
  const amount = Number.isFinite(value) ? value : 0
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    // Unknown/invalid ISO currency code — fall back to a plain number.
    return `${amount.toLocaleString('ru-RU')}${currency ? ` ${currency}` : ''}`
  }
}
