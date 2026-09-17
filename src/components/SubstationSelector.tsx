import React from 'react'
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native'
import type { SubstationInfo } from '../hooks/useSubstations'
import { SubstationIcon } from './SubstationIcon'

const CARD_ICON_SIZE = 36
const ICON_RESTING_COLOR = '#FFFFF0'

interface Props {
  substations: SubstationInfo[]
  currentSlug: string
  onSelect: (slug: string) => void
}

interface SubstationCardProps {
  substation: SubstationInfo
  isActive: boolean
  onSelect: (slug: string) => void
}

function SubstationCard({ substation, isActive, onSelect }: SubstationCardProps) {
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
      <SubstationIcon
        name={substation.icon}
        size={CARD_ICON_SIZE}
        color={isActive ? substation.color : ICON_RESTING_COLOR}
      />
      <Text style={styles.name} numberOfLines={1}>
        {substation.name}
      </Text>
      {isActive && <Text style={[styles.indicator, { color: substation.color }]}>●</Text>}
    </TouchableOpacity>
  )
}

export function SubstationSelector({ substations, currentSlug, onSelect }: Props) {
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
    // Translucent lift. Calibrated on the site for the old `#0d0d0d` surface;
    // the app surface is now `--bg-secondary` `#1a1a1a`, one step lighter, so the
    // overlay is bumped (0.03 → 0.05 / active 0.06 → 0.09) to keep the card
    // reading as a raised surface above it instead of dissolving into the page.
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    minWidth: 80,
    position: 'relative',
  },
  cardActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    // `.substation-card--active`:
    //   box-shadow: 0 0 20px rgba(0,0,0,.3), inset 0 0 15px rgba(255,255,255,.02)
    // Web: exact CSS string — the legacy props below would drop the `inset`
    // term (react-native-web only builds a single outer box-shadow from them).
    // Native: outer shadow only; `inset` has no RN equivalent.
    ...Platform.select({
      web: {
        boxShadow: '0 0 20px rgba(0,0,0,0.3), inset 0 0 15px rgba(255,255,255,0.02)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 6,
      },
    }),
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
