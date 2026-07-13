import { useEffect, useRef } from 'react';
import { API_BASE_URL } from '@env';

export function useLocationBroadcaster(
    userId: string | null,
    token: string | null,
    latitude: number,
    longitude: number,
    heading: number,
    speedMs: number,
    isDNDActive: boolean
) {
    const lastBroadcastRef = useRef(0);
    const lastDNDStateRef = useRef<boolean | null>(null);

    useEffect(() => {
        if (!userId || !token || latitude === 0) return;

        const now = Date.now();
        const dndChanged = lastDNDStateRef.current !== isDNDActive;
        if (!dndChanged && now - lastBroadcastRef.current < 5000) return;

        lastBroadcastRef.current = now;
        lastDNDStateRef.current = isDNDActive;

        const payload = {
            latitude,
            longitude,
            heading,
            speed: speedMs * 3.6,
            isDnd: isDNDActive,
        };

        fetch(`${API_BASE_URL}/users/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload),
        }).catch(() => { });
    }, [userId, token, latitude, longitude, heading, speedMs, isDNDActive]);
}
