import React, { useCallback } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Logo from '../../assets/logo-wordmark.svg'
import { APP_SURFACE_BG } from '../../utils/layout'
import { BlockRenderer } from './BlockRenderer'
import { CONTENT, CONTENT_MAX_WIDTH, CONTENT_PADDING } from './theme'
import type { PromoBlock } from './types'

interface PageContentProps {
  blocks: PromoBlock[]
  /** On-page heading rendered above the blocks (e.g. the promo title). */
  title?: string
  /** Document/tab title; when set, configures the expo-router screen. */
  screenTitle?: string
}

/**
 * Promo-page shell modelled on `app/app/copyright.tsx`: dark surface, back
 * button + logo header, a centred 560px scroll column, then the CMS blocks.
 * The route itself stays with frontend-dev — this component only paints.
 */
export function PageContent({ blocks, title, screenTitle }: PageContentProps) {
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
      {!!screenTitle && <Stack.Screen options={{ title: screenTitle, headerShown: false }} />}

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Назад"
        >
          <Ionicons name="arrow-back" size={22} color={CONTENT.text} />
        </TouchableOpacity>
        <Logo width={130} height={28} accessibilityLabel="RAW Radio" />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {!!title && (
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        )}
        <BlockRenderer blocks={blocks} />
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
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 8,
    paddingBottom: 48,
  },
  title: {
    color: CONTENT.heading,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 24,
  },
})
