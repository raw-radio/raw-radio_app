import { createContext } from 'react'
import { Platform, useWindowDimensions } from 'react-native'

/**
 * Web layout frame.
 *
 * The UI is mobile-first, so on desktop browsers it would otherwise stretch
 * edge-to-edge and look wrong. Parity with the web player (`web/src/index.scss`
 * `body` / `#root` + `web/src/styles/player.scss` `.player`): from 768px up the
 * web build renders the whole app inside a centred mobile-width card. Native
 * (Android/iOS) and narrow web viewports stay full-bleed and untouched.
 */

/**
 * Viewport width (px) at/above which the web build shows the centred card.
 * Mirrors the site's `@media (min-width: 768px)` — below that the player is
 * full-bleed (`body { background: #0d0d0d }`).
 */
export const APP_FRAME_BREAKPOINT = 768

/** Mobile-width cap for the column — matches web `--container-max` (480px). */
export const COLUMN_MAX_WIDTH = 480

/**
 * Page backdrop of the *unframed* layout (`body { background: #0d0d0d }`).
 * Doubles as the app surface colour — the column fill.
 */
export const APP_SURFACE_BG = '#0d0d0d'

/** Alias kept for the unframed shell: the page behind the full-bleed app. */
export const FRAME_OUTER_BG = APP_SURFACE_BG

/**
 * Page backdrop of the *framed* desktop layout — `body { background: #080808 }`
 * inside `@media (min-width: 768px)`. Darker than the surface so the card reads
 * as a floating device.
 */
export const FRAME_OUTER_BG_FRAMED = '#080808'

/** Card border — `border: 1px solid var(--raw-color-border-default, #333)`. */
export const FRAME_BORDER_COLOR = '#333'

/** Card corner radius — `border-radius: var(--raw-radius-lg, 1rem)` = 16px. */
export const FRAME_RADIUS = 16

/**
 * Gap kept between the card and the viewport edges — `margin: 2rem auto`.
 * 2rem = 32px, so the column is capped at `viewportHeight - 2 * 32`.
 */
export const FRAME_MARGIN = 32

/** Total vertical space the 2rem top+bottom margins reserve. */
export const FRAME_MARGIN_TOTAL = FRAME_MARGIN * 2

/**
 * Content inset inside the card — `.player { padding: 1.5rem }`. This is the
 * offset that makes the app look "floating" inside its frame.
 */
export const FRAME_CONTENT_PADDING = 24

/**
 * Rendered height (px) of the centred app column, published by the root layout.
 * `null` on native / narrow web, where no framed column exists.
 *
 * The chat bottom sheet uses this instead of the raw window height: RN Web
 * renders `Modal` through a portal appended to `document.body`, so the sheet
 * lives *outside* the column and must match the box it visually belongs to.
 */
export const ColumnHeightContext = createContext<number | null>(null)

export interface AppFrame {
  /** True on web when the viewport is wide enough for the framed column. */
  framed: boolean
  /** Live viewport width in px (re-renders on resize/rotation). */
  width: number
  /** Live viewport height in px (re-renders on resize/rotation). */
  height: number
}

/**
 * Live web-frame state. `framed` is web-only, so `Platform.OS === 'web'` gates
 * the whole frame and native builds can never pick up the max-width/border.
 * `useWindowDimensions` keeps it reactive to resize and rotation.
 */
export function useAppFrame(): AppFrame {
  const { width, height } = useWindowDimensions()
  return {
    framed: Platform.OS === 'web' && width >= APP_FRAME_BREAKPOINT,
    width,
    height,
  }
}
