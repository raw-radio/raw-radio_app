import React from 'react'
import { View } from 'react-native'
import type { BlockOf } from '../types'

const SPACER_HEIGHTS = { s: 8, m: 16, l: 32 } as const

/** Vertical rhythm spacer. */
export function SpacerBlock({ block }: { block: BlockOf<'spacer'> }) {
  return <View style={{ height: SPACER_HEIGHTS[block.size] ?? SPACER_HEIGHTS.m }} />
}
