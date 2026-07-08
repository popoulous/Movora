# Movora — Android client (React Native)

A Movora media client for **Android phones/tablets and Android TV** (Android 10+),
built with React Native. It mirrors the webOS TV app (`apps/webos`): pair with the
server, browse libraries, and play episodes with **multi-audio-track and subtitle
selection** (per-series remembered audio language), backed by `react-native-video`
(ExoPlayer/Media3 under the hood).

> **Status: shipped.** Runs on phones and Android TV (RN 0.76.6, package `com.movora`,
> minSdk 29); release APKs are attached to the GitHub Releases. Server auto-discovery
> on the LAN, code pairing, the on-device capability probe, a custom VTT subtitle
> overlay, 7-language i18n, double-tap seeking and skip-intro/outro chips all mirror
> the other clients, and playback is OOM-safe on low-RAM devices (memory-capped
> ExoPlayer buffering).

## Layout

```
apps/android/
  index.js                 # AppRegistry entry
  app.json                 # app name
  package.json             # deps (react-native, react-native-video, react-navigation…)
  src/
    App.tsx                # providers + navigation stack
    theme.ts               # Movora palette (shared look with web/webOS)
    api/client.ts          # REST client (ported from apps/webos) — fetch + bearer token
    context/DeviceContext  # pairing/config persisted in AsyncStorage
    discovery.ts           # LAN server auto-discovery
    i18n/                  # 7 languages (hu/en/de/fr/es/it/ja), shared key set with web/webOS
    components/            # shared branding/gradient UI pieces
    navigation.ts          # typed route table
    screens/
      WelcomeScreen        # auto-discovery + server URL + 6-digit pairing code
      HomeScreen           # continue-watching + libraries + recently added
      LibraryScreen        # poster grid
      SeriesScreen         # detail + episode list
      PlayerScreen         # react-native-video + audio/subtitle pickers, skip chips
      CapabilityScreen     # on-device playback probe -> capability report
      SettingsScreen       # server info + unpair
```

## Prerequisites

- Node 18+
- JDK 17
- Android Studio + Android SDK (API 34+), an Android 10+ device/emulator (or an
  Android TV emulator/device)

## Run

The native `android/` project is included, so it's just:

```bash
cd apps/android
npm install        # JS deps (already pinned to RN-0.76-compatible versions)
npm start          # Metro bundler (keep running in one terminal)
npm run android    # build + install on the connected device/emulator (another terminal)
npm run typecheck  # tsc --noEmit (green)
```

`npm run android` needs `ANDROID_HOME` set (or `android/local.properties` with `sdk.dir`).
In Android Studio, open the **`apps/android/android`** folder (the Gradle project), not
`apps/android`.

### Android TV notes

The app already installs on Android TV (`minSdk 29`, leanback declared `required=false`).
To list it on the TV home row, add a `LEANBACK_LAUNCHER` category to the main activity's
intent-filter plus an `android:banner` drawable. For richer TV focus control later, swap
`react-native` for the `react-native-tvos` fork (`TVFocusGuideView`, `hasTVPreferredFocus`).

## Notes

- **Pairing** uses the same backend flow as webOS (`/api/devices/pair/*`): the app shows
  a 6-digit code, you approve it in the Movora web UI (Settings → pair a TV).
- **Playback** streams `/api/episodes/{id}/stream?token=…`. The player lists the stream's
  audio tracks on load and remembers the chosen **language per series**
  (`movora_audio_pref_<seriesId>`), mirroring the webOS/web clients. Subtitles render in
  a custom VTT overlay fed from `/api/episodes/{id}/subtitles` (ASS is fetched as
  `?as=vtt`) — `react-native-video`'s own text tracks proved too limited.
