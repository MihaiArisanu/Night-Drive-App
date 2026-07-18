import { DeviceEventEmitter } from 'react-native';

export const SPONTANEOUS_RIDE_PUSH_EVENT = 'spontaneousRidePush';

export interface SpontaneousRidePushPayload {
    offerId: string;
    friendName?: string;
    distanceMeters?: number;
    roadDistanceMeters?: number;
    expiresAt: string;
}

export function notifySpontaneousRidePush(payload: SpontaneousRidePushPayload) {
    DeviceEventEmitter.emit(SPONTANEOUS_RIDE_PUSH_EVENT, payload);
}
