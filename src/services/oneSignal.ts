import { OneSignal, LogLevel } from 'react-native-onesignal'

/**
 * Initialise OneSignal and subscribe to notification events.
 *
 * MUST be called from a React effect (not at module scope): the native SDK
 * creates a NativeEventEmitter, which requires the React Native bridge to be
 * ready — calling it earlier throws "NativeEventEmitter() requires a non-null
 * argument".
 *
 * Returns an unsubscribe function to be invoked on unmount.
 */
export function initOneSignal(
  appId: string,
  onNotificationTap: (url: string | null) => void,
): () => void {
  OneSignal.Debug.setLogLevel(LogLevel.Verbose)
  OneSignal.initialize(appId)
  OneSignal.Notifications.requestPermission(true)

  const handleClick = (event: any) => {
    const url: string | undefined = event?.notification?.additionalData?.url
    onNotificationTap(url ?? null)
  }
  const handleForeground = (_event: any) => {
    // v5 displays foreground notifications automatically.
    // Call event.preventDefault() here if we ever want to suppress them.
  }

  OneSignal.Notifications.addEventListener('click', handleClick)
  OneSignal.Notifications.addEventListener('foregroundWillDisplay', handleForeground)

  return () => {
    OneSignal.Notifications.removeEventListener('click', handleClick)
    OneSignal.Notifications.removeEventListener('foregroundWillDisplay', handleForeground)
  }
}

/**
 * The current push subscription id, or `null` if the device has not registered
 * yet (no permission / no push token).
 *
 * v5.5.11 exposes only `OneSignal.User.pushSubscription.getIdAsync()` — there is
 * no synchronous `pushSubscription.id` property in this version.
 */
export function getSubscriptionId(): Promise<string | null> {
  return OneSignal.User.pushSubscription.getIdAsync()
}
