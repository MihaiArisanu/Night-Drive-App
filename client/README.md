# NightDrive Mobile Client

The NightDrive client is a React Native 0.84 application written in TypeScript. It presents navigation, social, group, reporting, and account features while delegating trust-sensitive decisions to the Go API.

The MVP has been tested primarily as an Android release build on physical devices. iOS project files exist, but Android is the currently demonstrated and validated platform.

## Implemented user experience

### Map and navigation

- dark Google map with GPS position, heading, speed, recentering, and destination search;
- standard route planning and Zen Engine sessions;
- turn-by-turn maneuver card and remaining route information;
- one active stop at a time, with the final destination marker preserved;
- disliked streets and finger-drawn avoidance polygons;
- saved places and nearby fuel-station search;
- driving focus mode that hides secondary controls after ten seconds without interaction;
- fixed portrait orientation and disabled accidental 3D map rotation during normal navigation.

### Friends and groups

- profile, avatar, unique tag, friend request, accept/decline, and remove-friend flows;
- social notification badge and Firebase push handling;
- nearby friend avatars on the map when server-side privacy rules allow them;
- persistent planned groups with invitations, pending states, owner label, members, destination, shared stops, leave, and close controls;
- spontaneous two-person ride offer sheet with a ten-second decision window;
- one-tap LiveKit push-to-talk with automatic stop after ten seconds, vibration feedback, and reconnect handling.

### Account and safety

- onboarding for location, microphone, and notification permissions;
- secure token storage through React Native Keychain;
- access-token refresh and a single-device session conflict/takeover dialog;
- profile editing, password validation, forgotten-password flow, and account deletion;
- DND control, privacy explanation, feedback submission, and Crashlytics reporting;
- community hazard creation, display, confirmation, and rejection.

## Client architecture

```text
App.tsx
  |-- screens/       route-level UI and user flows
  |-- components/    reusable visual and interaction components
  |-- hooks/         feature orchestration and lifecycle logic
  |-- services/      API, session, push, crash, and event adapters
  |-- store/         Zustand application state
  |-- navigation/    React Navigation configuration
  `-- android/ios/   native permissions, Firebase, LiveKit, and build integration
```

Business authorization is intentionally not trusted to the client. For example, the app may request nearby friends, but the server decides which locations are visible based on current database membership and expiring Redis data.

## Main technologies

- React Native 0.84 and React 19;
- TypeScript;
- React Navigation;
- Zustand;
- react-native-maps and Google Maps Platform;
- react-native-geolocation-service;
- React Native Firebase Messaging and Crashlytics;
- LiveKit React Native/WebRTC;
- React Native Keychain;
- React Native Permissions, Gesture Handler, Safe Area Context, SVG, TTS, Image Picker, and Toast Message.

Exact direct and transitive versions are declared in `package.json` and `package-lock.json`.

## Requirements

- Node.js 22.11 or newer and npm;
- Android Studio, Android SDK/platform tools, a compatible JDK, and an Android device or emulator;
- a reachable NightDrive API;
- a Google Maps Platform API key;
- `android/app/google-services.json` from the Firebase project;
- for voice testing, a LiveKit server reachable from the device.

## Environment configuration

Create the local client file:

```bash
cp .env.example .env
```

Example for a physical Android device on the same LAN as the Docker host:

```dotenv
API_BASE_URL=http://192.168.1.100/api/v1
GOOGLE_API_GENERAL_KEY=your_google_maps_platform_key
ALLOW_CLEARTEXT_TRAFFIC=true
```

`API_BASE_URL` must include `/api/v1`. The same Google key is injected into the native Android manifest and is available to JavaScript for Google Places requests. Restrict this key in Google Cloud for the Android application and only the required APIs.

`ALLOW_CLEARTEXT_TRAFFIC=true` is intended only for local MVP testing. A public build must use HTTPS/WSS and set it to `false`.

## Install and run

Install dependencies:

```bash
npm install
```

Start Metro for a debug workflow:

```bash
npx react-native start
```

Build and install the release mode used during MVP testing:

```bash
npx react-native run-android --mode="release"
```

If the device uses a USB-only local development connection, Android port reversal can expose a directly published backend port:

```bash
adb reverse tcp:8080 tcp:8080
```

This does not make LiveKit UDP media reachable. Group voice on physical devices still requires a LAN/public LiveKit address that the device can access.

For iOS development on macOS:

```bash
bundle install
cd ios
bundle exec pod install
cd ..
npx react-native run-ios
```

iOS remains less extensively validated than Android in the current MVP.

## Runtime permissions

NightDrive requests only capabilities used by an implemented feature:

| Permission | Reason |
| --- | --- |
| Fine/coarse location | navigation, speed/heading, live friend and spontaneous ride eligibility |
| Microphone | LiveKit group voice transmissions |
| Notifications | friend, group, and spontaneous ride notifications |
| Internet | API, maps, Firebase, and LiveKit connectivity |
| Vibration | short voice and spontaneous-offer feedback |

Android backup is disabled. The main activity is locked to portrait because the driving UI is designed and tested for portrait use.

## Location and battery behavior

The location watcher requests high accuracy, updates at approximately one-second intervals, and uses a two-meter distance filter while active. Location broadcasting is separately throttled by the application and server-side data expires after 60 seconds. This behavior favors navigation responsiveness; formal battery benchmarking and background-mode optimization remain roadmap work.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm test
```

Jest and ESLint are configured, but the repository currently has no comprehensive automated client test suite. The MVP has been validated mainly through manual release builds on real Android devices, including two-device group and LiveKit scenarios.

## Release status and known gaps

- the Android release build currently uses the debug signing key and has code shrinking disabled;
- local cleartext API/LiveKit addresses are still used for MVP testing;
- iOS requires additional full-device regression testing;
- accessibility, battery, memory, offline, and poor-network testing are incomplete;
- production push/Crashlytics behavior depends on valid Firebase configuration;
- automated UI and integration tests are not yet implemented.

Before store distribution, configure a private release keystore, enable appropriate release optimization, use public HTTPS/WSS services, rotate/restrict keys, and complete the automated and device test matrix.

## Troubleshooting

- **API requests fail:** confirm that `API_BASE_URL` includes `/api/v1`, the phone can reach the host, and Caddy/API containers are healthy.
- **Map is blank:** verify `GOOGLE_API_GENERAL_KEY`, enabled Google APIs, billing, Android package/SHA restrictions, and device connectivity.
- **Group voice stays disconnected:** verify `LIVEKIT_NODE_IP`, `LIVEKIT_PUBLIC_URL`, TCP/UDP firewall rules, and that the device can reach LiveKit directly.
- **Push notifications do not arrive:** verify notification permission, `google-services.json`, the backend Firebase service account, and FCM token registration.
- **Environment changes are ignored:** stop Metro/build processes, clean the native build if needed, and rebuild because `.env` values are bundled at build time.

For backend setup, privacy rules, and external-resource declarations, see the repository root README and `api/README.md`.
