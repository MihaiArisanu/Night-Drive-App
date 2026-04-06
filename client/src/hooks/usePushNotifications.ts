import { useEffect } from 'react';
import messaging from '@react-native-firebase/messaging';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';

export function usePushNotifications() {
    const { token } = useSettingsStore();

    useEffect(() => {
        if (!token) return;

        const setupNotifications = async () => {
            try {
                const authStatus = await messaging().requestPermission();
                const enabled =
                    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
                    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

                if (enabled) {
                    const fcmToken = await messaging().getToken();

                    if (fcmToken) {
                        try {
                            await fetch(`${API_BASE_URL}/api/users/fcm`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({ token: fcmToken })
                            });
                        } catch (error) {
                            console.log("Failed to sync FCM token:", error);
                        }
                    }
                }
            } catch (error) {
                console.warn("Firebase Messaging setup skipped (likely missing google-services.json):", error);
            }
        };

        setupNotifications();

        let unsubscribe = () => {};
        try {
            unsubscribe = messaging().onMessage(async remoteMessage => {
                console.log('New notification in foreground:', remoteMessage);
            });
        } catch (error) {
            console.warn("Firebase Messaging listener skipped:", error);
        }

        return unsubscribe;
    }, [token]);
}