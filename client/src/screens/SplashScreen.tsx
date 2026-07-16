import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Video from 'react-native-video';
import { ApiError, AuthStorage } from '../services/api';
import { restoreAuthenticatedSession } from '../services/sessionBootstrap';
import { useSettingsStore } from '../store/useSettingsStore';

export default function SplashScreen({ navigation }: any) {
    useEffect(() => {
        const bootApp = async () => {
            try {
                const token = await AuthStorage.getAccessToken();

                if (token) {
                    useSettingsStore.getState().setToken(token);
                    try {
                        await restoreAuthenticatedSession();
                    } catch (error) {
                        if (
                            error instanceof ApiError
                            && (error.code === 'session_replaced' || error.code === 'account_deleted')
                        ) {
                            await AuthStorage.clearTokens();
                            navigation.replace('Auth', { isLogin: true });
                            return;
                        }
                        // Authentication is still valid when session recovery
                        // is temporarily unavailable. Main can reconnect later.
                        console.warn('Could not fully restore the current session:', error);
                    }
                    navigation.replace('Main');
                } else {
                    navigation.replace('Onboarding');
                }
            } catch (error) {
                console.error("Eroare la bootare:", error);
                navigation.replace('Welcome');
            }
        };

        setTimeout(() => {
            bootApp();
        }, 5500);
    }, [navigation]);

    return (
        <View style={styles.container}>
            <Video
                source={require('../assets/Logo_animation.mp4')}
                style={styles.videoLogo}
                muted={true}
                repeat={false}
                resizeMode="contain"
            />
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
    videoLogo: {
        width: 250,
        height: 250,
        marginBottom: 10
    },
    appName: {
        color: '#8A2BE2',
        fontSize: 32,
        fontWeight: 'bold',
        letterSpacing: 2
    },
});
