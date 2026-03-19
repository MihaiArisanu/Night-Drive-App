# 📱 NightDrive Mobile Client

This is the frontend of the NightDrive ecosystem. A cross-platform mobile application designed for high performance and a premium "dark mode" user experience.

## 🛠️ Frontend Tech Stack

* **Framework:** [React Native](https://reactnative.dev/) (v0.7x)
* **Language:** TypeScript
* **Maps:** [React Native Maps](https://github.com/react-native-maps/react-native-maps) with Google Maps Provider.
* **Icons:** Lucide-React-Native.
* **State & Logic:** Custom Hooks for modularity (`useCurrentUser`, `useFriendRequests`, `useDeleteAccount`).

## 🔑 Key Features
* **Interactive Map:** Custom midnight-themed styling with real-time GPS tracking.
* **Reporting System:** Long-press gesture to report traffic events (Police, Potholes, Accidents).
* **Profile Management:** Secure account deletion and profile editing.
* **Social Integration:** Add drivers by unique TAGs and manage friend requests.

## 🛠️ Development

1. Install dependencies: `npm install`
2. Install iOS pods (macOS only): `cd ios && pod install && cd ..`
3. Start Metro Bundler: `npx react-native start`
4. Run on device: `npx react-native run-android` or `npx react-native run-ios`