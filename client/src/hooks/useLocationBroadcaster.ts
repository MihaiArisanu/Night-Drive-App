import { useEffect, useRef } from 'react';
import { API_BASE_URL } from '@env';

export function useLocationBroadcaster(
    userId: string | null,
    latitude: number,
    longitude: number,
    heading: number,
    speedMs: number,
    isDNDActive: boolean
) {
    const lastBroadcastRef = useRef(0);

    useEffect(() => {
        if (!userId || latitude === 0) return;

        const now = Date.now();
        if (now - lastBroadcastRef.current < 5000) return;

        lastBroadcastRef.current = now;

        const payload = {
            userId,
            latitude,
            longitude,
            heading,
            speed: speedMs * 3.6,
            isDnd: isDNDActive,
        };

        fetch(`${API_BASE_URL}/api/users/location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        }).catch(() => {
        });
    }, [userId, latitude, longitude, heading, speedMs, isDNDActive]);
}