import { AppRegistry, LogBox } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerGlobals } from '@livekit/react-native';

registerGlobals();

LogBox.ignoreLogs([
    'This method is deprecated',
    'Firebase namespaced API'
]);

AppRegistry.registerComponent(appName, () => App);
