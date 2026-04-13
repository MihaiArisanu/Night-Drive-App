import { useEffect } from 'react';
import messaging from '@react-native-firebase/messaging';
import { apiFetch } from '../services/api';
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
                            await apiFetch('/users/fcm', {
                                method: 'PUT',
                                body: JSON.stringify({ token: fcmToken })
                            });
                            console.log("🚀 FCM Token synced successfully!");
                        } catch (error) {
                            console.log("❌ Failed to sync FCM token:", error);
                        }
                    }
                }
            } catch (error) {
                console.warn("Firebase Messaging setup skipped:", error);
            }
        };

        setupNotifications();

        let unsubscribe = () => { };
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