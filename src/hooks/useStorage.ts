import AsyncStorage from '@react-native-async-storage/async-storage'

export const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key)
    } catch {
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value)
    } catch {
      // Storage unavailable
    }
  },
}

export const STORAGE_KEYS = {
  VOLUME: 'raw-radio-volume',
  MUTED: 'raw-radio-muted',
  SUBSTATION: 'raw-radio-substation',
  CHAT_NICKNAME: 'chatNickname',
} as const
