export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds) || seconds < 0) return '--:--'
  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${minutes}:${String(secs).padStart(2, '0')}`
}
