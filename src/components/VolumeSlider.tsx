import React from 'react'
import { View, TouchableOpacity, StyleSheet } from 'react-native'
import Slider from '@react-native-community/slider'
import { Ionicons } from '@expo/vector-icons'

interface VolumeSliderProps {
  volume: number
  muted: boolean
  onChange: (v: number) => void
  onToggleMute: () => void
}

export function VolumeSlider({ volume, muted, onChange, onToggleMute }: VolumeSliderProps) {
  const iconName: keyof typeof Ionicons.glyphMap = muted || volume === 0
    ? 'volume-mute'
    : volume < 0.5
      ? 'volume-low'
      : 'volume-high'

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onToggleMute} style={styles.button} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
        <Ionicons name={iconName} size={18} color="#aaa" />
      </TouchableOpacity>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={1}
        step={0.01}
        value={muted ? 0 : volume}
        onValueChange={onChange}
        minimumTrackTintColor="#ff6b35"
        maximumTrackTintColor="#2a2a2a"
        thumbTintColor="#ff6b35"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  button: {
    padding: 8,
  },
  slider: {
    flex: 1,
    height: 40,
    marginLeft: 8,
  },
})
