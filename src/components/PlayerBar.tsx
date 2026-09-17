import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { OnDemandTrack } from '../types'
import { formatDuration } from '../utils/format'
import { APP_SURFACE_BG_RAISED } from '../utils/layout'

interface PlayerBarProps {
  track: OnDemandTrack
  progress: { currentTime: number; duration: number }
  onStop: () => void
}

export function PlayerBar({ track, progress, onStop }: PlayerBarProps) {
  const { currentTime, duration } = progress
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="musical-notes" size={18} color="#ff6b35" />
      </View>
      <View style={styles.info}>
        <Text style={styles.trackName} numberOfLines={1}>{track.title}</Text>
        {track.artist && <Text style={styles.trackArtist} numberOfLines={1}>{track.artist}</Text>}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
      </View>
      <Text style={styles.time}>
        {formatDuration(currentTime)} / {formatDuration(duration || null)}
      </Text>
      <TouchableOpacity onPress={onStop} style={styles.backBtn} accessibilityLabel="Return to radio">
        <Ionicons name="radio" size={20} color="#ff6b35" />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  // Was `#1a1a1a` (`--bg-secondary`) over the old `#0d0d0d` app surface. The
  // surface is now `--bg-secondary`, so the bar lifts one step to
  // `--bg-tertiary` to stay a visible strip; otherwise it would be the same
  // colour as the screen behind it and only the 1px divider would show.
  container: { flexDirection: 'row', alignItems: 'center', backgroundColor: APP_SURFACE_BG_RAISED, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#222' },
  iconWrap: { marginRight: 10 },
  info: { flex: 1 },
  trackName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  trackArtist: { color: '#888', fontSize: 12, marginTop: 1 },
  progressBar: { height: 3, backgroundColor: '#333', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#ff6b35', borderRadius: 2 },
  time: { color: '#666', fontSize: 11, marginHorizontal: 10 },
  backBtn: { padding: 8 },
})
