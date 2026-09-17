// Web push is NOT supported by react-native-onesignal. This is an intentional
// no-op so the shared _layout.tsx can import the module without a platform branch.
// Web push (if ever added) is a separate integration (react-onesignal + service worker).
export function initOneSignal(
  _appId: string,
  _onNotificationTap: (url: string | null) => void,
): () => void {
  return () => {}
}

export function getSubscriptionId(): Promise<string | null> {
  return Promise.resolve(null)
}
