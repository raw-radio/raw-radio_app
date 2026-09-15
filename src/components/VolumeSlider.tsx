import React, { useCallback, useEffect, useRef } from 'react'
import { View, TouchableOpacity, StyleSheet } from 'react-native'
import Slider from '@react-native-community/slider'
import { Ionicons } from '@expo/vector-icons'
import { storage, STORAGE_KEYS } from '../hooks/useStorage'

const VOLUME_SAVE_DEBOUNCE_MS = 500

interface VolumeSliderProps {
  volume: number
  muted: boolean
  onChange: (v: number) => void
  onToggleMute: () => void
}

export function VolumeSlider({ volume, muted, onChange, onToggleMute }: VolumeSliderProps) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The slider fires `onValueChange` on every tick. Apply the audio change
  // immediately, but debounce the persistence write until the drag settles.
  const handleValueChange = useCallback(
    (v: number) => {
      onChange(v)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        storage.setItem(STORAGE_KEYS.VOLUME, String(v))
      }, VOLUME_SAVE_DEBOUNCE_MS)
    },
    [onChange],
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

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
        onValueChange={handleValueChange}
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
