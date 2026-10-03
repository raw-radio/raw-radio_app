import React from 'react'
import { StyleSheet, View } from 'react-native'
import { CONTENT } from '../theme'

/** Hairline separator. */
export function DividerBlock() {
  return <View style={styles.divider} />
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: CONTENT.border,
    marginVertical: 20,
  },
})
