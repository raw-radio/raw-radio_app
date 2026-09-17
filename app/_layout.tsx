import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import {
  APP_SURFACE_BG,
  COLUMN_MAX_WIDTH,
  ColumnHeightContext,
  FRAME_BORDER_COLOR,
  FRAME_CONTENT_PADDING,
  FRAME_MARGIN,
  FRAME_OUTER_BG,
  FRAME_OUTER_BG_FRAMED,
  FRAME_RADIUS,
  useAppFrame,
} from '../src/utils/layout'

// Register the playback service at module scope so it is wired up BEFORE
// TrackPlayer.setupPlayer() runs (setup happens in useAudioPlayer's effect).
// Without this, remote events (notification pause/play/skip) update the
// notification UI but never reach the player.
//
// This import intentionally has NO file extension: _layout.tsx is shared
// between web and native, so Metro resolves the platform variant —
// registerPlaybackService.ts (native, RNTP) vs registerPlaybackService.web.ts
// (web no-op). Web must not pull in react-native-track-player: its web path
// depends on shaka-player, which is unreliable for live ICY/MP3 radio.
import '../src/services/registerPlaybackService'

// Same platform-split trick: oneSignal.ts (native, react-native-onesignal)
// vs oneSignal.web.ts (intentional no-op — the SDK does not support RN Web).
import { initOneSignal } from '../src/services/oneSignal'

/**
 * Only in-app deep links are acceptable as a push navigation target.
 * Rejects absolute URLs (`https://…`), protocol-relative URLs (`//evil.com`)
 * and anything that is not a plain `/path` — the tap payload is remote input.
 */
function isSafeInternalUrl(url: string | null): url is string {
  return !!url && /^\/(?!\/)/.test(url)
}

export default function RootLayout() {
  const router = useRouter()
  // Web-only desktop card: viewport >= breakpoint gets a centred column.
  const { framed, height } = useAppFrame()
  const [columnHeight, setColumnHeight] = useState<number | null>(null)

  const handleColumnLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout
    setColumnHeight((prev) => (prev === height ? prev : height))
  }, [])

  // The framed column takes the full available height (`flex: 1`), so this cap
  // is what keeps the 2rem top/bottom margins (`margin: 2rem auto` on the site)
  // visible at all times: tall content scrolls inside the card instead of
  // pushing the card past the viewport.
  // const columnMaxHeight = useMemo(() => getColumnMaxHeight(height), [height])

  useEffect(() => {
    const appId = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID || ''
    if (!appId) return

    const unsubscribe = initOneSignal(appId, (url) => {
      if (!isSafeInternalUrl(url)) return
      try {
        router.push(url)
      } catch {
        // Malformed target — ignore the tap rather than crash the app.
      }
    })

    return unsubscribe
  }, [router])

  return (
    <SafeAreaProvider>
      {/*
        `viewport` is the full-bleed shell. On the framed desktop layout it
        paints the darker backdrop and centres the card; on native / narrow web
        it is the plain app background, so nothing shifts there.
      */}
      <View style={[styles.viewport, framed && styles.viewportFramed]}>
        <SafeAreaView
          style={[
            styles.column,
            // `flex: 1` in BOTH modes. The framed card must still resolve to a
            // definite height: `frameContent` below is `flex: 1` and a flex child
            // of a container with no definite height collapses to 0 in Yoga, so
            // dropping it in framed mode blanked the whole screen. `maxHeight`
            // caps the card at `viewportHeight - 64` instead of stretching it, and
            // the parent's centring keeps the 2rem margins visible.
            styles.columnFull,
            framed && [styles.columnFramed, { maxHeight: height * 0.8 }],
          ]}
          onLayout={framed ? handleColumnLayout : undefined}
        >
          <ColumnHeightContext.Provider value={framed ? columnHeight : null}>
            <StatusBar style="light" />
            {/*
              Content inset (`.player { padding: 1.5rem }` on the site) lives on
              this inner wrapper, not on `SafeAreaView`: the web implementation
              of `SafeAreaView` re-writes the padding shorthand from the insets
              and would clobber it. `minHeight: 0` keeps the flex children
              shrinkable so the nested list stays the internal scroll region.
            */}
            <View style={[styles.frameContent, framed && styles.frameContentFramed]}>
              <ErrorBoundary>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: APP_SURFACE_BG },
                  }}
                />
              </ErrorBoundary>
            </View>
          </ColumnHeightContext.Provider>
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  // Full-bleed shell: the page backdrop on web, a transparent passthrough
  // wrapper on native (where the column fills it and paints the surface).
  viewport: { flex: 1, width: '100%', backgroundColor: FRAME_OUTER_BG },
  viewportFramed: {
    // Backdrop darkens behind the card (`body { background: #080808 }` inside
    // `@media (min-width: 768px)`) and the card is centred both ways.
    minHeight: '100%',
    backgroundColor: FRAME_OUTER_BG_FRAMED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // App surface. On native / narrow web this is the only wrapper (unchanged).
  column: { width: '100%', backgroundColor: APP_SURFACE_BG },
  // Applied in BOTH modes so the column always has a definite height inside the
  // `flex: 1` shell — in framed mode `maxHeight` caps it (leaving the 2rem
  // margins) instead of it stretching to fill the viewport.
  columnFull: { flex: 1 },
  // Desktop card, web >= APP_FRAME_BREAKPOINT only. Mirrors the site's
  // `#root` inside `@media (min-width: 768px)`: 480px wide, 1px #333 border,
  // 1rem radius, `margin: 2rem auto`, `0 10px 25px rgba(0,0,0,.5)` shadow and
  // the #0d0d0d surface. `overflow: hidden` clips children to the rounded
  // corners and makes the card the scroll container for long content.
  columnFramed: {
    maxWidth: COLUMN_MAX_WIDTH,
    marginVertical: FRAME_MARGIN,
    borderWidth: 1,
    borderColor: FRAME_BORDER_COLOR,
    borderRadius: FRAME_RADIUS,
    overflow: 'hidden',
    backgroundColor: APP_SURFACE_BG,
    // `box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5)`. Used instead of the
    // `shadow*` shorthand because RNW maps the string form straight to CSS and
    // logs a deprecation warning for the legacy props.
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
  },
  // Single flex child inside the card. `flex: 1` + `minHeight: 0` lets the
  // screens shrink inside a height-capped card, so their nested list scrolls
  // internally while the page itself never scrolls.
  frameContent: { flex: 1, width: '100%', minHeight: 0 },
  // `.player { padding: 1.5rem }` — the inset that makes the app look offset
  // inside its frame. Web desktop only (native stays full-bleed).
  frameContentFramed: { padding: FRAME_CONTENT_PADDING },
})
