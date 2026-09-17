import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTrackSearch } from '../hooks/useTrackSearch'
import { formatDuration } from '../utils/format'
import type { OnDemandTrack } from '../types'

interface TrackSearchModalProps {
  isOpen: boolean
  onClose: () => void
  onTrackSelect: (track: OnDemandTrack) => void
}

export function TrackSearchModal({ isOpen, onClose, onTrackSelect }: TrackSearchModalProps) {
  const [query, setQuery] = useState('')
  const { tracks, loading, error, hasMore, loadMore, reset } = useTrackSearch(query)

  const handleClose = useCallback(() => {
    setQuery('')
    reset()
    onClose()
    Keyboard.dismiss()
  }, [onClose, reset])

  const handleTrackSelect = useCallback(
    (track: OnDemandTrack) => {
      // The search field is focused (and the soft keyboard is up) while the user
      // taps a result. Dismiss it explicitly so the keyboard cannot linger over
      // the player, and so the tap is unambiguously a "play" intent.
      Keyboard.dismiss()
      onTrackSelect({ id: track.id, title: track.title, artist: track.artist, duration: track.duration })
    },
    [onTrackSelect],
  )

  const renderItem = useCallback(
    ({ item }: { item: OnDemandTrack }) => (
      <TouchableOpacity style={styles.resultItem} onPress={() => handleTrackSelect(item)} activeOpacity={0.7}>
        <View style={styles.resultIcon}>
          <Ionicons name="musical-notes" size={16} color="#888" />
        </View>
        <View style={styles.resultInfo}>
          <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
          {item.artist && <Text style={styles.resultArtist} numberOfLines={1}>{item.artist}</Text>}
        </View>
        <Text style={styles.resultDuration}>{formatDuration(item.duration)}</Text>
        <TouchableOpacity onPress={() => handleTrackSelect(item)} style={styles.playBtnSmall}>
          <Ionicons name="play" size={16} color="#ff6b35" />
        </TouchableOpacity>
      </TouchableOpacity>
    ),
    [handleTrackSelect],
  )

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <View style={styles.searchInputWrapper}>
            <Ionicons name="search" size={18} color="#888" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search tracks..."
              placeholderTextColor="#666"
              autoFocus
              autoCorrect={false}
            />
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#aaa" />
          </TouchableOpacity>
        </View>

        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          // CRITICAL: the search TextInput is `autoFocus`, so the soft keyboard is
          // up for every tap on a result. With the default (`'never'`) RN's
          // ScrollView eats that first tap in the responder-capture phase
          // (`_handleStartShouldSetResponderCapture`) and only dismisses the
          // keyboard — `onPress` never fires, which looked exactly like "tapping a
          // track produces no sound". `'handled'` lets the row receive the press
          // while still dismissing the keyboard on taps that miss the rows.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator size="large" color="#ff6b35" style={{ marginTop: 40 }} />
            ) : query.trim().length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="search" size={48} color="#333" />
                <Text style={styles.emptyText}>Start typing to search...</Text>
              </View>
            ) : error ? (
              <View style={styles.emptyState}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="search" size={48} color="#333" />
                <Text style={styles.emptyText}>Nothing found</Text>
              </View>
            )
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity style={styles.loadMore} onPress={loadMore} disabled={loading}>
                <Text style={styles.loadMoreText}>{loading ? 'Loading...' : 'Load more'}</Text>
              </TouchableOpacity>
            ) : null
          }
          onEndReachedThreshold={0.5}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0d0d0d', paddingTop: 50 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#222' },
  searchInputWrapper: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, marginLeft: 8 },
  closeBtn: { padding: 8, marginLeft: 8 },
  resultItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  resultIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  resultInfo: { flex: 1, marginLeft: 12 },
  resultTitle: { color: '#fff', fontSize: 15 },
  resultArtist: { color: '#888', fontSize: 13, marginTop: 2 },
  resultDuration: { color: '#666', fontSize: 13, marginRight: 12 },
  playBtnSmall: { padding: 8 },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#666', fontSize: 16, marginTop: 12 },
  errorText: { color: '#ff4444', fontSize: 14 },
  loadMore: { padding: 16, alignItems: 'center' },
  loadMoreText: { color: '#ff6b35', fontSize: 14 },
})
