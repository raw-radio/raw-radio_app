import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { CONTENT } from '../theme'
import type { BlockOf } from '../types'
import { formatMoney } from '../utils'

/**
 * Fundraising progress bar. `collected`/`goal` are clamped so a bad payload
 * (goal ≤ 0, over-collection) can never render a bar outside 0–100%.
 */
export function ProgressBlock({ block }: { block: BlockOf<'progress'> }) {
  const goal = Number.isFinite(block.goal) ? block.goal : 0
  const collected = Number.isFinite(block.collected) ? block.collected : 0
  const ratio = goal > 0 ? Math.max(0, Math.min(1, collected / goal)) : 0
  const percent = Math.round(ratio * 100)

  return (
    <View style={styles.wrap}>
      {!!block.label && (
        <Text selectable style={styles.label}>
          {block.label}
        </Text>
      )}

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
      >
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {formatMoney(collected, block.currency)} из {formatMoney(goal, block.currency)}
        </Text>
        <Text style={styles.percent}>{percent}%</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 16,
  },
  label: {
    color: CONTENT.heading,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: CONTENT.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: CONTENT.accent,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  meta: {
    color: CONTENT.text,
    fontSize: 14,
  },
  percent: {
    color: CONTENT.accent,
    fontSize: 14,
    fontWeight: '700',
  },
})
