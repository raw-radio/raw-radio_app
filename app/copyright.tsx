import React, { useCallback } from 'react'
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { APP_SURFACE_BG, APP_SURFACE_BG_RAISED } from '../src/utils/layout'

/**
 * Legal screen «Правообладателям» (rights holders / copyright).
 *
 * Content is ported verbatim from web/public/copyright.html — the static page
 * that is still served by the legacy site. Keep the wording in sync; do not
 * paraphrase or drop sentences.
 */

/** Public complaint address — taken verbatim from the HTML source. */
const COPYRIGHT_EMAIL = 'copyright@raw-radio.ru'
const COPYRIGHT_EMAIL_URL = `mailto:${COPYRIGHT_EMAIL}`

/** «Ст. 1253.1 ГК РФ — Ответственность информационного посредника». */
const LAW_URL =
  'https://www.consultant.ru/document/cons_doc_LAW_64629/eb6ec591cb78fe25054cd4b9e0dbcc79abcf0d3a/'

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

export default function CopyrightScreen() {
  const router = useRouter()

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    // Opened directly (deep link / bookmark) — nothing to pop, go home instead.
    router.replace('/')
  }, [router])

  /**
   * `Linking.openURL` covers native; on web we go through the DOM so that
   * `mailto:` stays in-page instead of spawning a blank tab.
   */
  const openExternal = useCallback((url: string) => {
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
  }, [])

  return (
    <View style={styles.container}>
      {/* Sets document.title on web; the header itself stays hidden like the rest of the app. */}
      <Stack.Screen options={{ title: 'Правообладателям — RAW Radio', headerShown: false }} />

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
        <Text style={styles.logo} allowFontScaling={false}>
          RAW
          <Text style={styles.logoAccent}>RADIO</Text>
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={styles.title}>
          Правообладателям
        </Text>

        <Text style={styles.paragraph}>
          RAW Radio — это некоммерческий проект, созданный для друзей и единомышленников.
        </Text>

        <Text style={styles.paragraph}>
          Все треки добавляются пользователями проекта. Мы не занимаемся самостоятельным
          наполнением музыкальной библиотеки.
        </Text>

        <Text style={styles.paragraph}>
          <Text style={styles.highlight}>Если вы являетесь правообладателем</Text> и считаете, что
          ваш контент используется на нашем сервисе без соответствующего разрешения, пожалуйста,
          свяжитесь с нами.
        </Text>

        <Text style={styles.paragraph}>
          Мы обязуемся удалить спорный трек в течение 24 часов после получения вашей жалобы.
        </Text>

        <View style={styles.contact}>
          <Text style={styles.contactLabel}>Контактный адрес для жалоб:</Text>
          <Text
            style={styles.contactLink}
            onPress={() => openExternal(COPYRIGHT_EMAIL_URL)}
            accessibilityRole="link"
            accessibilityLabel={COPYRIGHT_EMAIL}
          >
            {COPYRIGHT_EMAIL}
          </Text>
        </View>

        <Text
          style={styles.lawLink}
          onPress={() => openExternal(LAW_URL)}
          accessibilityRole="link"
        >
          Ст. 1253.1 ГК РФ — Ответственность информационного посредника
        </Text>

        <Text
          style={styles.backLink}
          onPress={handleBack}
          accessibilityRole="link"
          accessibilityLabel="Вернуться на RAW Radio"
        >
          ← Вернуться на RAW Radio
        </Text>
      </ScrollView>
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
  logo: {
    color: '#fff',
    fontFamily: MONO_FONT,
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: -0.3,
  },
  logoAccent: { color: '#ff6b35' },
  scroll: { flex: 1 },
  // Mirrors the 560px `.container` of the static page.
  content: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 48,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 24,
  },
  paragraph: {
    color: '#b3b3b3',
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 16,
  },
  highlight: { color: '#fff', fontWeight: '600' },
  contact: {
    marginTop: 16,
    padding: 20,
    // Was `#1a1a1a` (`--bg-secondary`) when the screen backdrop was the old
    // `#0d0d0d` surface. The screen now uses `--bg-secondary` itself, so the
    // raised panel moves up one step to `--bg-tertiary` to keep reading as a
    // distinct block (the static copyright.html used the same #1a1a1a panel on
    // a #0d0d0d page — same one-step lift).
    backgroundColor: APP_SURFACE_BG_RAISED,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 16,
  },
  contactLabel: { color: '#b3b3b3', fontSize: 14, marginBottom: 4 },
  contactLink: { color: '#ff6b35', fontSize: 15, fontWeight: '600' },
  lawLink: {
    marginTop: 24,
    color: '#737373',
    fontSize: 13,
    lineHeight: 20,
  },
  backLink: {
    marginTop: 32,
    color: '#ff6b35',
    fontSize: 14,
    fontWeight: '600',
  },
})
