import React from 'react'
import { View, TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { PlayerState, StreamStatus } from '../types'

interface PlayerProps {
  state: PlayerState
  status: StreamStatus
  onToggle: () => void
  isLive?: boolean
  liveLabel?: string
}

export function Player({ state, status, onToggle, isLive = false, liveLabel }: PlayerProps) {
  const isPlaying = state === 'playing' || state === 'buffering' || state === 'loading' || state === 'reconnecting'
  const isLoading = state === 'loading' || state === 'buffering' || state === 'reconnecting'
  const isError = state === 'error' || state === 'offline' || state === 'reconnecting'

  return (
    <View style={styles.hero}>
      <View style={styles.playBtnWrap}>
        <TouchableOpacity
          style={[styles.playBtn, isError && styles.playBtnOffline]}
          onPress={onToggle}
          activeOpacity={0.7}
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={48}
              color="#fff"
              style={!isPlaying ? { marginLeft: 4 } : undefined}
            />
          )}
        </TouchableOpacity>
      </View>

      {isLive ? (
        <View style={styles.nowPlaying}>
          <Text style={styles.trackTitle}>{liveLabel?.trim() || 'Listen live'}</Text>
        </View>
      ) : (
        status.trackTitle && (
          <View style={styles.nowPlaying}>
            <Text style={styles.trackTitle} numberOfLines={1}>{status.trackTitle}</Text>
            {status.trackArtist && (
              <Text style={styles.trackArtist} numberOfLines={1}>
                {' — '}{status.trackArtist}
              </Text>
            )}
          </View>
        )
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  playBtnWrap: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnOffline: {
    backgroundColor: '#666',
  },
  nowPlaying: {
    alignItems: 'center',
    marginTop: 24,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  trackArtist: {
    color: '#aaa',
    fontSize: 16,
    marginTop: 4,
    textAlign: 'center',
  },
})
