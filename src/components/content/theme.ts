import { Platform } from 'react-native'
import { APP_SURFACE_BG_RAISED } from '../../utils/layout'

/**
 * Content-page palette, sampled from `app/app/copyright.tsx` so promo pages
 * read as the same surface: white headings, grey body, orange accent, `#333`
 * hairlines, raised `#2a2a2a` panels.
 */
export const CONTENT = {
  heading: '#fff',
  text: '#b3b3b3',
  accent: '#ff6b35',
  accentSoft: 'rgba(255, 107, 53, 0.14)',
  accentBorder: 'rgba(255, 107, 53, 0.3)',
  border: '#333',
  panel: APP_SURFACE_BG_RAISED,
  muted: '#737373',
  white: '#fff',
  qrOnWhite: '#000',
} as const

/** Content column width — mirrors the 560px `.container` of copyright.html. */
export const CONTENT_MAX_WIDTH = 560

/** Shared horizontal content inset (matches copyright / player: 16px). */
export const CONTENT_PADDING = 16

export const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
})
