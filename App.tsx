import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './src/navigation/AppNavigator.tsx';
import { SettingsProvider } from './src/context/SettingsContext.tsx';

function App(): React.JSX.Element {
  return (
    <SettingsProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </SettingsProvider>
  );
}

export default App;