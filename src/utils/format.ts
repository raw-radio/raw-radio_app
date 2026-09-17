export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds) || seconds < 0) return '--:--'
  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

/**
 * Strips control characters and truncates now-playing text before it is handed
 * to the OS media session (Android notification via react-native-track-player,
 * web Media Session API).
 *
 * The source is the stream's WebSocket now-playing payload — untrusted, since
 * anyone who can publish stream metadata can put arbitrary bytes in it. Control
 * characters (newlines, NUL, ANSI escapes) would either be rendered verbatim in
 * the notification or corrupt the metadata call. Returns `null` for an absent or
 * content-less value so the caller keeps its own fallback semantics.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g
const MAX_MEDIA_TEXT_LENGTH = 100

export function sanitizeMediaText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(CONTROL_CHARS, '').trim().slice(0, MAX_MEDIA_TEXT_LENGTH)
  return cleaned || null
}
