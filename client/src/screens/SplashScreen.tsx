import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image, Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { AuthStorage } from '../services/api';
import { useSettingsStore } from '../store/useSettingsStore';

export default function SplashScreen({ navigation }: any) {
    useEffect(() => {
        const checkPermissionsAndAuth = async () => {
            let locationGranted = false;

            if (Platform.OS === 'android') {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
                );
                locationGranted = granted === PermissionsAndroid.RESULTS.GRANTED;
            } else if (Platform.OS === 'ios') {
                const auth = await Geolocation.requestAuthorization('whenInUse');
                locationGranted = auth === 'granted';
            }

            if (!locationGranted) {
                navigation.replace('PermissionError');
                return;
            }

            const token = await AuthStorage.getToken();
            if (token) {
                useSettingsStore.getState().setToken(token);
                navigation.replace('Main');
            } else {
                navigation.replace('Welcome');
            }
        };

        setTimeout(() => {
            checkPermissionsAndAuth();
        }, 1500);
    }, []);

    return (
        <View style={styles.container}>
            <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.appName}>NightDrive</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center'
    },
    logo: {
        width: 150,
        height: 150,
        marginBottom: 20
    },
    appName: {
        color: '#8A2BE2',
        fontSize: 32,
        fontWeight: 'bold',
        letterSpacing: 2
    },
});