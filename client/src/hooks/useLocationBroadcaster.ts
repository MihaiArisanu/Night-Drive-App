import { useCallback, useEffect, useRef } from 'react';
import { API_BASE_URL } from '@env';

const LOCATION_HEARTBEAT_INTERVAL_MS = 5000;

type BroadcastState = {
    userId: string | null;
    token: string | null;
    latitude: number;
    longitude: number;
    heading: number;
    speedMs: number;
    accuracy: number;
    isDNDActive: boolean;
    navigationMode: 'none' | 'destination' | 'zen';
    destination: { latitude: number; longitude: number } | null;
};

export function useLocationBroadcaster(
    userId: string | null,
    token: string | null,
    latitude: number,
    longitude: number,
    heading: number,
    speedMs: number,
    accuracy: number,
    isDNDActive: boolean,
    navigationMode: 'none' | 'destination' | 'zen',
    destination: { latitude: number; longitude: number } | null,
) {
    const latestStateRef = useRef<BroadcastState>({
        userId,
        token,
        latitude,
        longitude,
        heading,
        speedMs,
        accuracy,
        isDNDActive,
        navigationMode,
        destination,
    });
    const lastDNDStateRef = useRef<boolean | null>(null);
    const lastNavigationKeyRef = useRef('');

    useEffect(() => {
        latestStateRef.current = {
            userId,
            token,
            latitude,
            longitude,
            heading,
            speedMs,
            accuracy,
            isDNDActive,
            navigationMode,
            destination,
        };
    }, [
        userId,
        token,
        latitude,
        longitude,
        heading,
        speedMs,
        accuracy,
        isDNDActive,
        navigationMode,
        destination,
    ]);

    const broadcastLatestLocation = useCallback(() => {
        const current = latestStateRef.current;
        if (!current.userId || !current.token || current.latitude === 0) return;

        lastDNDStateRef.current = current.isDNDActive;
        lastNavigationKeyRef.current = current.destination
            ? `${current.navigationMode}:${current.destination.latitude.toFixed(6)}:${current.destination.longitude.toFixed(6)}`
            : current.navigationMode;

        const payload = {
            latitude: current.latitude,
            longitude: current.longitude,
            heading: current.heading,
            speed: current.speedMs * 3.6,
            accuracy: current.accuracy,
            isDnd: current.isDNDActive,
            navigation: {
                mode: current.navigationMode,
                destination: current.navigationMode === 'destination'
                    ? current.destination
                    : undefined,
            },
        };

        fetch(`${API_BASE_URL}/users/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${current.token}`
            },
            body: JSON.stringify(payload),
        }).catch(() => { });
    }, []);

    // Location watchers are allowed to stay quiet while the phone is stationary.
    // The heartbeat keeps presence fresh and drives proximity evaluation anyway.
    useEffect(() => {
        if (!userId || !token) return;

        broadcastLatestLocation();
        const interval = setInterval(
            broadcastLatestLocation,
            LOCATION_HEARTBEAT_INTERVAL_MS,
        );
        return () => clearInterval(interval);
    }, [userId, token, broadcastLatestLocation]);

    // Privacy and route changes must reach the backend immediately rather than
    // waiting for the next heartbeat.
    useEffect(() => {
        if (!userId || !token || latitude === 0) return;

        const navigationKey = destination
            ? `${navigationMode}:${destination.latitude.toFixed(6)}:${destination.longitude.toFixed(6)}`
            : navigationMode;
        const dndChanged = lastDNDStateRef.current !== isDNDActive;
        const navigationChanged = lastNavigationKeyRef.current !== navigationKey;
        if (dndChanged || navigationChanged) {
            broadcastLatestLocation();
        }
    }, [
        userId,
        token,
        latitude,
        isDNDActive,
        navigationMode,
        destination,
        broadcastLatestLocation,
    ]);
}
