import { DeviceEventEmitter } from 'react-native';

const SOCIAL_NOTIFICATIONS_CHANGED = 'nightdrive:social-notifications-changed';

export const notifySocialNotificationsChanged = () => {
    DeviceEventEmitter.emit(SOCIAL_NOTIFICATIONS_CHANGED);
};

export const subscribeToSocialNotificationChanges = (listener: () => void) => (
    DeviceEventEmitter.addListener(SOCIAL_NOTIFICATIONS_CHANGED, listener)
);
