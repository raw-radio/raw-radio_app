import React, { useEffect, useRef } from 'react'
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native'
import type { SubstationInfo } from '../hooks/useSubstations'
import { SubstationIcon } from './SubstationIcon'
import { useReducedMotion } from '../hooks/useReducedMotion'

const CARD_ICON_SIZE = 36
const ICON_PULSE_MS = 2000
const ICON_PULSE_MAX_SCALE = 1.1
const INDICATOR_GLOW_MS = 1500
const INDICATOR_GLOW_MIN_OPACITY = 0.6

interface Props {
  substations: SubstationInfo[]
  currentSlug: string
  onSelect: (slug: string) => void
}

interface SubstationCardProps {
  substation: SubstationInfo
  isActive: boolean
  onSelect: (slug: string) => void
  reducedMotion: boolean
}

function SubstationCard({ substation, isActive, onSelect, reducedMotion }: SubstationCardProps) {
  const iconScale = useRef(new Animated.Value(1)).current
  const indicatorOpacity = useRef(new Animated.Value(INDICATOR_GLOW_MIN_OPACITY)).current

  useEffect(() => {
    if (!isActive || reducedMotion) {
      iconScale.stopAnimation()
      indicatorOpacity.stopAnimation()
      iconScale.setValue(1)
      indicatorOpacity.setValue(INDICATOR_GLOW_MIN_OPACITY)
      return
    }

    // `substation-pulse`: scale 1 → 1.1 → 1 over 2s, only on the active card.
    const iconAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(iconScale, {
          toValue: ICON_PULSE_MAX_SCALE,
          duration: ICON_PULSE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconScale, {
          toValue: 1,
          duration: ICON_PULSE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    // `substation-glow`: opacity 0.6 → 1 → 0.6 over 1.5s.
    const indicatorAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(indicatorOpacity, {
          toValue: 1,
          duration: INDICATOR_GLOW_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(indicatorOpacity, {
          toValue: INDICATOR_GLOW_MIN_OPACITY,
          duration: INDICATOR_GLOW_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    iconAnimation.start()
    indicatorAnimation.start()

    return () => {
      iconAnimation.stop()
      indicatorAnimation.stop()
    }
  }, [indicatorOpacity, iconScale, isActive, reducedMotion])

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isActive && styles.cardActive,
        { borderColor: isActive ? substation.color : 'rgba(255, 255, 255, 0.1)' },
      ]}
      onPress={() => onSelect(substation.slug)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={substation.name}
      accessibilityState={{ selected: isActive }}
    >
      <Animated.View style={{ transform: [{ scale: iconScale }] }}>
        <SubstationIcon name={substation.icon} size={CARD_ICON_SIZE} color="#FFFFF0" />
      </Animated.View>
      <Text style={styles.name} numberOfLines={1}>
        {substation.name}
      </Text>
      {isActive && (
        <Animated.Text
          style={[styles.indicator, { color: substation.color, opacity: indicatorOpacity }]}
        >
          ●
        </Animated.Text>
      )}
    </TouchableOpacity>
  )
}

export function SubstationSelector({ substations, currentSlug, onSelect }: Props) {
  const reducedMotion = useReducedMotion()

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {substations.map((sub) => (
        <SubstationCard
          key={sub.slug}
          substation={sub}
          isActive={sub.slug === currentSlug}
          onSelect={onSelect}
          reducedMotion={reducedMotion}
        />
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    width: '100%',
  },
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  card: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    minWidth: 80,
    position: 'relative',
  },
  cardActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 6,
  },
  name: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    letterSpacing: 0.5,
    lineHeight: 13,
    textAlign: 'center',
  },
  indicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 8,
  },
})
