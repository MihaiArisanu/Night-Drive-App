import React from 'react';
import { View, Text } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import MainScreen from '../screens/MainScreen';
import MenuScreen from '../screens/MenuScreen';

const Stack = createStackNavigator();

const MapPlaceholder = () => (
  <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ color: '#fff' }}>Harta Google Maps va apărea aici</Text>
  </View>
);

export const AppNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#000000' }
      }}
    >
      <Stack.Screen name="Main" component={MainScreen} />
      <Stack.Screen name="Menu" component={MenuScreen} />
      <Stack.Screen name="Map" component={MapPlaceholder} />
    </Stack.Navigator>
  );
};