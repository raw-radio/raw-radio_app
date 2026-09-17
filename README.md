# RAW Radio App

Cross-platform client (Android + Web) for the RAW Radio internet radio station. It plays live streams from multiple substations, shows now-playing metadata, lets listeners search and play tracks on demand, and provides a real-time listener chat.

## Tech Stack

| Layer          | Technology                                              |
| -------------- | ------------------------------------------------------- |
| Framework      | Expo SDK 57                                             |
| UI runtime     | React 19.2.3, React Native 0.86.3                       |
| Navigation     | Expo Router                                             |
| Audio (native) | `react-native-track-player`                             |
| Audio (web)    | HTML5 `<audio>` element                                 |
| Realtime       | `socket.io-client` (stream status + chat)               |
| Storage        | `@react-native-async-storage/async-storage`             |
| Language       | TypeScript                                              |
| Platforms      | Android, Web                                            |

## Requirements

- Node.js 20 or newer
- npm
- For native Android builds: Android Studio (with Android SDK and an emulator or connected device)

## Setup

```bash
npm install
cp .env.example .env   # fill EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WS_URL
npm run start          # dev server
npm run web            # web target
npm run android        # native Android
```

## Project Structure

```
app/
├── app/                      # Expo Router screens
│   ├── _layout.tsx           # Root layout (safe area, status bar, stack)
│   └── index.tsx             # Home screen
├── src/
│   ├── api/
│   │   └── client.ts         # HTTP client, now-playing, track search
│   ├── components/
│   │   ├── ChatSheet.tsx     # Listener chat panel
│   │   ├── Player.tsx        # Main player UI
│   │   ├── PlayerBar.tsx     # On-demand track progress bar
│   │   ├── ShareButton.tsx   # Stream share action
│   │   ├── SubstationSelector.tsx
│   │   ├── TrackSearchModal.tsx
│   │   └── VolumeSlider.tsx
│   ├── hooks/
│   │   ├── useAudioPlayer.ts      # Native audio (react-native-track-player)
│   │   ├── useAudioPlayer.web.ts  # Web audio (HTML <audio>)
│   │   ├── useChat.ts             # Chat state via socket.io
│   │   ├── useStorage.ts          # AsyncStorage helpers
│   │   ├── useStreamStatus.ts     # Live status + now-playing via socket.io
│   │   ├── useSubstations.ts      # Substation list
│   │   └── useTrackSearch.ts      # Track search
│   ├── services/
│   │   ├── oneSignal.ts           # OneSignal init (native)
│   │   ├── oneSignal.web.ts       # Web no-op (SDK is native-only)
│   │   ├── registerPlaybackService.ts     # RNTP playback service registration
│   │   ├── registerPlaybackService.web.ts # Web no-op
│   │   └── trackPlayerService.ts  # Remote control event handlers
│   ├── types/
│   │   └── index.ts          # Shared TypeScript types
│   └── utils/
│       └── format.ts         # Formatting helpers
├── assets/                   # Icons, splash and adaptive icon images
├── app.json                  # Expo configuration
├── tsconfig.json
└── .env.example
```

## Architecture

The audio layer is platform-split. Metro resolves `useAudioPlayer` to a different implementation per platform:

- `src/hooks/useAudioPlayer.ts` — native Android playback backed by `react-native-track-player`.
- `src/hooks/useAudioPlayer.web.ts` — web playback using a plain HTML5 `<audio>` element.

Both implementations expose the same hook API, so the UI in `app/index.tsx` stays platform-agnostic. Realtime features (stream status and chat) use `socket.io-client` in both targets.

## Configuration

The app is configured entirely through public Expo environment variables, defined in `.env` (copied from `.env.example`):

| Variable                | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `EXPO_PUBLIC_API_URL`   | Base URL of the RAW Radio HTTP API               |
| `EXPO_PUBLIC_WS_URL`    | URL of the realtime (socket.io) server           |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | OneSignal app id used for push notifications |

Example values use placeholders only:

```
EXPO_PUBLIC_API_URL=https://your-api.example
EXPO_PUBLIC_WS_URL=https://your-ws.example
```

Only variables prefixed with `EXPO_PUBLIC_` are embedded into the client bundle and are therefore **public**. Never place secrets, tokens, private keys, or credentials in this repository or in `EXPO_PUBLIC_*` variables. `.env` files are git-ignored.

## Push notifications (OneSignal)

Phase 1: the app **receives** push notifications. Sending from the admin panel is a later phase.

- **Env var**: `EXPO_PUBLIC_ONESIGNAL_APP_ID` must hold the OneSignal app id. It is a public identifier (it ships inside the bundle, like the Firebase config), so an empty placeholder is committed in `.env.example` and the real value lives in the git-ignored `.env`. If the variable is empty, OneSignal init is skipped entirely.
- **Credentials**: the **FCM v1 Service Account JSON** is a secret. It goes **only** into the OneSignal dashboard (Settings → Push & In-App → Android → FCM v1). It must **never** be added to this repository, to `.env`, or to `app.json` — the repo is public.
- **Expo Go is not supported**: `react-native-onesignal` is a native module, so a **dev build / prebuild** is required (`npx expo prebuild --platform android` then `npm run android`). Send a test push from the OneSignal dashboard (Audience → Subscriptions → New Message → Test) after the app registers.
- **Runtime permission**: the app requests notification permission on first launch (`requestPermission(true)`).
- **Tap handling**: a push may carry a deep link in `additionalData.url` (e.g. `additionalData: { "url": "/?station=rock" }`). Only internal paths starting with a single `/` are accepted; absolute (`https://…`) and protocol-relative (`//…`) URLs are ignored. There is currently a single route (`/`), so links resolve to the home screen.
- **Release builds**: `app.json` uses `mode: "development"` for the OneSignal plugin (the option is required even for Android-only). Change it to `"production"` before shipping a release build and re-run `npx expo prebuild --platform android --clean`.
- **Web push is not supported in this phase.** `react-native-onesignal` has no React Native Web build, so `src/services/oneSignal.web.ts` is an intentional no-op and no OneSignal code is bundled for web. Web push would be a separate integration (`react-onesignal` + a service worker).
- **Logging**: the native SDK runs at `LogLevel.Verbose` while this feature is being brought up; lower it before release.

## License

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](./LICENSE) for the full text.

## Contributing

Contributions are welcome. Open an issue to discuss a change before submitting a pull request, keep changes focused, and make sure the project builds for both Android and Web.
