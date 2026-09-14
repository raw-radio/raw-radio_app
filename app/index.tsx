import React, { useState, useCallback } from 'react'
import { View, ScrollView, StyleSheet, TouchableOpacity, Text } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAudioPlayer } from '../src/hooks/useAudioPlayer'
import { useStreamStatus } from '../src/hooks/useStreamStatus'
import { useSubstations } from '../src/hooks/useSubstations'
import { useChat } from '../src/hooks/useChat'
import { Player } from '../src/components/Player'
import { VolumeSlider } from '../src/components/VolumeSlider'
import { SubstationSelector } from '../src/components/SubstationSelector'
import { TrackSearchModal } from '../src/components/TrackSearchModal'
import { PlayerBar } from '../src/components/PlayerBar'
import { ChatSheet } from '../src/components/ChatSheet'
import { ShareButton } from '../src/components/ShareButton'
import type { OnDemandTrack } from '../src/types'

export default function HomeScreen() {
  const { substations, currentSlug, selectSubstation } = useSubstations()
  const { status, connected, refreshNowPlaying } = useStreamStatus(currentSlug)
  const { messages, showLiveLabel, liveLabelText } = useChat(currentSlug)
  const {
    toggle, state, volume, setVolume, muted, toggleMute,
    mode, currentTrack, trackProgress, playTrack, stopTrack,
  } = useAudioPlayer(currentSlug)

  const [searchOpen, setSearchOpen] = useState(false)
  const [chatVisible, setChatVisible] = useState(false)

  const isLive = status.type === 'live' || showLiveLabel

  const handlePlay = useCallback(async () => {
    await toggle()
    refreshNowPlaying()
  }, [toggle, refreshNowPlaying])

  const handleTrackSelect = useCallback((track: OnDemandTrack) => {
    setSearchOpen(false)
    playTrack(track)
  }, [playTrack])

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
        <View style={styles.topBar}>
          <View style={[styles.connectionDot, { backgroundColor: connected ? '#2ECC71' : '#ff4444' }]} />
          <View style={styles.topBarActions}>
            <TouchableOpacity onPress={() => setSearchOpen(true)} style={styles.topBtn}>
              <Ionicons name="search" size={20} color="#aaa" />
            </TouchableOpacity>
            <ShareButton slug={currentSlug || 'main'} />
          </View>
        </View>

        <SubstationSelector
          substations={substations}
          currentSlug={currentSlug || 'main'}
          onSelect={selectSubstation}
        />

        <Player
          state={state}
          status={status}
          onToggle={handlePlay}
          isLive={isLive}
          liveLabel={liveLabelText}
        />

        <View style={styles.bottomControls}>
          <VolumeSlider volume={volume} muted={muted} onChange={setVolume} onToggleMute={toggleMute} />
          <TouchableOpacity onPress={() => setChatVisible(!chatVisible)} style={styles.chatToggle}>
            <Ionicons name="chatbubble-ellipses" size={22} color={chatVisible ? '#ff6b35' : '#aaa'} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {mode === 'track' && currentTrack && (
        <PlayerBar track={currentTrack} progress={trackProgress} onStop={stopTrack} />
      )}

      <TrackSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} onTrackSelect={handleTrackSelect} />
      <ChatSheet isOpen={chatVisible} onClose={() => setChatVisible(false)} substationSlug={currentSlug} messages={messages} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d' },
  scrollContent: { flexGrow: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  connectionDot: { width: 8, height: 8, borderRadius: 4 },
  topBarActions: { flexDirection: 'row', alignItems: 'center' },
  topBtn: { padding: 12 },
  bottomControls: { paddingBottom: 24 },
  chatToggle: { alignItems: 'center', paddingVertical: 8 },
})
