import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import { SafeAreaProvider } from 'react-native-safe-area-context'; // <-- IMPORTUL NOU ADAUGAT

import SplashScreen from './src/screens/SplashScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import AuthScreen from './src/screens/AuthScreen';
import MainScreen from './src/screens/MainScreen';
import PermissionErrorScreen from './src/screens/PermissionDeniedScreen';
import MenuScreen from './src/screens/MenuScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import SavedPlacesScreen from './src/screens/SavedPlacesScreen';
import DislikedStreetsScreen from './src/screens/DislikedStreetsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import FriendsScreen from './src/screens/FriendsScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="PermissionError" component={PermissionErrorScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Auth" component={AuthScreen} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ headerShown: false }} />
          <Stack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
          <Stack.Screen name="DislikedStreets" component={DislikedStreetsScreen} />
          <Stack.Screen name="Friends" component={FriendsScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="Main" component={MainScreen} />
          <Stack.Screen
            name="Menu"
            component={MenuScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <Toast position="bottom" bottomOffset={80} />
    </SafeAreaProvider>
  );
}