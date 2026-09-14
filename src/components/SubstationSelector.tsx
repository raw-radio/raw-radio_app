import React from 'react'
import { Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { SubstationInfo } from '../hooks/useSubstations'

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  radio: 'radio',
  music: 'musical-notes',
  headphones: 'headset',
  globe: 'globe',
  star: 'star',
  heart: 'heart',
  flame: 'flame',
  bolt: 'flash',
  moon: 'moon',
  sun: 'sunny',
}

interface Props {
  substations: SubstationInfo[]
  currentSlug: string
  onSelect: (slug: string) => void
}

export function SubstationSelector({ substations, currentSlug, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {substations.map((sub) => {
        const isActive = sub.slug === currentSlug
        const iconName = ICON_MAP[sub.icon] || 'radio'

        return (
          <TouchableOpacity
            key={sub.slug}
            style={[styles.card, isActive && styles.cardActive, { borderColor: isActive ? sub.color : '#333' }]}
            onPress={() => onSelect(sub.slug)}
            activeOpacity={0.7}
            accessibilityLabel={sub.name}
          >
            <Ionicons name={iconName} size={25} color={isActive ? sub.color : '#888'} />
            <Text style={[styles.name, isActive && { color: sub.color }]} numberOfLines={1}>
              {sub.name}
            </Text>
            {isActive && <Text style={[styles.indicator, { color: sub.color }]}>●</Text>}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    minWidth: 80,
  },
  cardActive: {
    backgroundColor: '#222',
  },
  name: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  indicator: {
    fontSize: 8,
    marginTop: 2,
  },
})
