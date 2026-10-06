import React, { useCallback } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Logo from '../../src/assets/logo-wordmark.svg'
import { PageContent } from '../../src/components/content'
import { usePromoPage } from '../../src/hooks/useClientContent'
import { APP_SURFACE_BG } from '../../src/utils/layout'

const ACCENT = '#ff6b35'

/**
 * Dynamic promo page (`/:prefix/:slug`) driven by the Client Content CMS.
 *
 * Both path segments come from the CMS record: `slug` identifies the page and
 * `prefix` is its configurable URL namespace (e.g. `/doob/support`). The route
 * is intentionally generic — the prefix is resolved per page by `usePromoPage`,
 * which rejects a page whose `routePrefix` does not match the URL.
 *
 * The page body is painted by `PageContent` (designer-owned); this route only
 * resolves the params, owns the loading / not-found / error states, and hands
 * the CMS blocks over. Search-engine visibility is handled globally (outer
 * nginx sends `X-Robots-Tag: noindex` on every response), so there is no
 * per-screen robots handling here — same as the rest of the app.
 */
export default function PromoPageScreen() {
  const params = useLocalSearchParams<{
    prefix?: string | string[]
    slug?: string | string[]
  }>()
  const prefix = Array.isArray(params.prefix) ? params.prefix[0] : params.prefix
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug
  const { page, isLoading, notFound, error } = usePromoPage(slug, prefix)

  if (isLoading) {
    return (
      <View style={styles.container}>
        {/* Sets document.title on web; header stays hidden like the rest of the app. */}
        <Stack.Screen options={{ title: 'RAW Radio', headerShown: false }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      </View>
    )
  }

  if (error) {
    return (
      <StatusScreen
        title="Не удалось загрузить"
        message="Проверьте соединение и попробуйте ещё раз."
      />
    )
  }

  if (notFound || !page) {
    return (
      <StatusScreen
        title="Страница не найдена"
        message="Возможно, ссылка устарела или страница была удалена."
      />
    )
  }

  return (
    <PageContent
      blocks={page.blocks}
      title={page.title}
      screenTitle={page.pageTitle ?? page.title}
    />
  )
}

/** Minimal dark state screen (loading fallback / not found) with a back affordance. */
function StatusScreen({ title, message }: { title: string; message: string }) {
  const router = useRouter()

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    // Opened directly (deep link / bookmark) — nothing to pop, go home instead.
    router.replace('/')
  }, [router])

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${title} — RAW Radio`, headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Назад"
        >
          <Ionicons name="arrow-back" size={22} color="#b3b3b3" />
        </TouchableOpacity>
        <Logo width={130} height={28} accessibilityLabel="RAW Radio" />
      </View>

      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#737373" />
        <Text style={styles.statusTitle}>{title}</Text>
        <Text style={styles.statusText}>{message}</Text>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.statusBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Вернуться на RAW Radio"
        >
          <Text style={styles.statusBtnText}>Вернуться на RAW Radio</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP_SURFACE_BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  // Matches `.header-btn` in player.scss: 40×40 hit area, 8px radius.
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 64,
    gap: 8,
  },
  statusTitle: {
    marginTop: 12,
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  statusText: {
    color: '#b3b3b3',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  statusBtn: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 53, 0.3)',
    backgroundColor: 'rgba(255, 107, 53, 0.14)',
  },
  statusBtnText: { color: ACCENT, fontSize: 14, fontWeight: '600' },
})
