import { useEffect } from 'react';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import Toast from 'react-native-toast-message';
import { apiFetch } from '../services/api';
import { useSettingsStore } from '../store/useSettingsStore';
import { notifySocialNotificationsChanged } from '../services/socialNotificationEvents';
import { notifySpontaneousRidePush } from '../services/spontaneousRideEvents';

function handleSpontaneousRideMessage(remoteMessage: FirebaseMessagingTypes.RemoteMessage): boolean {
    const data = remoteMessage?.data;
    const notificationType = typeof data?.notificationType === 'string' ? data.notificationType : '';
    const offerId = typeof data?.offerId === 'string' ? data.offerId : '';
    const expiresAt = typeof data?.expiresAt === 'string' ? data.expiresAt : '';
    if (notificationType !== 'SPONTANEOUS_RIDE_OFFER' || !offerId || !expiresAt) {
        return false;
    }
    notifySpontaneousRidePush({
        offerId,
        friendName: typeof data?.friendName === 'string' ? data.friendName : undefined,
        distanceMeters: Number(data?.distanceMeters) || 0,
        roadDistanceMeters: Number(data?.roadDistanceMeters) || 0,
        expiresAt,
    });
    return true;
}

export function usePushNotifications() {
    const { token } = useSettingsStore();

    useEffect(() => {
        if (!token) return;

        const syncToken = async (fcmToken: string) => {
            if (!fcmToken) return;
            try {
                await apiFetch('/users/fcm', {
                    method: 'PUT',
                    body: JSON.stringify({ token: fcmToken }),
                });
            } catch (error) {
                console.warn('Failed to sync notification token:', error);
            }
        };

        const setupNotifications = async () => {
            try {
                const authStatus = await messaging().requestPermission();
                const enabled =
                    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
                    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

                if (enabled) {
                    const fcmToken = await messaging().getToken();

                    await syncToken(fcmToken);
                }
            } catch (error) {
                console.warn("Firebase Messaging setup skipped:", error);
            }
        };

        setupNotifications();

        let unsubscribeForeground = () => { };
        let unsubscribeTokenRefresh = () => { };
        try {
            unsubscribeForeground = messaging().onMessage(async remoteMessage => {
                if (handleSpontaneousRideMessage(remoteMessage)) return;
                notifySocialNotificationsChanged();
                Toast.show({
                    type: 'info',
                    text1: remoteMessage.notification?.title || 'New NightDrive notification',
                    text2: remoteMessage.notification?.body || 'Open Friends to view it.',
                    position: 'top',
                    visibilityTime: 4000,
                });
            });
            const unsubscribeNotificationOpened = messaging().onNotificationOpenedApp(remoteMessage => {
                handleSpontaneousRideMessage(remoteMessage);
            });
            messaging().getInitialNotification()
                .then(remoteMessage => {
                    if (remoteMessage) handleSpontaneousRideMessage(remoteMessage);
                })
                .catch(() => undefined);
            unsubscribeTokenRefresh = messaging().onTokenRefresh(syncToken);

            const previousForegroundUnsubscribe = unsubscribeForeground;
            unsubscribeForeground = () => {
                previousForegroundUnsubscribe();
                unsubscribeNotificationOpened();
            };
        } catch (error) {
            console.warn("Firebase Messaging listener skipped:", error);
        }

        return () => {
            unsubscribeForeground();
            unsubscribeTokenRefresh();
        };
    }, [token]);
}
