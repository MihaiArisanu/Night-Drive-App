import { AppRegistry, LogBox } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerGlobals } from '@livekit/react-native';
import { initializeCrashReporting } from './src/services/crashReporting';
import messaging from '@react-native-firebase/messaging';

registerGlobals();
initializeCrashReporting().catch(() => undefined);
messaging().setBackgroundMessageHandler(async () => undefined);

LogBox.ignoreLogs([
    'This method is deprecated',
    'Firebase namespaced API'
]);

AppRegistry.registerComponent(appName, () => App);
