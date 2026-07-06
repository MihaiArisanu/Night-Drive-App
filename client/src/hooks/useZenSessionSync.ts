import { useEffect, useRef } from 'react';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';

export function useZenSessionSync(
    isZenSession: boolean,
    latitude: number,
    longitude: number,
    appendRoute: (newCoords: { latitude: number, longitude: number }[]) => void
) {
    const { token } = useSettingsStore();

    const stateRef = useRef({ latitude, longitude, appendRoute });

    useEffect(() => {
        stateRef.current = { latitude, longitude, appendRoute };
    }, [latitude, longitude, appendRoute]);

    useEffect(() => {
        if (!isZenSession) return;

        const interval = setInterval(async () => {
            const { latitude: currentLat, longitude: currentLng, appendRoute: currentAppendRoute } = stateRef.current;

            if (currentLat === 0) return;

            try {
                const response = await fetch(`${API_BASE_URL}/routes/zen/sync`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        latitude: currentLat,
                        longitude: currentLng
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP Error: ${response.status}`);
                }

                const data = await response.json();

                if (data.status === 'extended' && data.next_lat && data.next_lng) {
                    currentAppendRoute([{
                        latitude: data.next_lat,
                        longitude: data.next_lng
                    }]);
                }
            } catch (error) {
                console.log("ZenSession sync failed, retrying on next tick...", error);
            }
        }, 10000);

        return () => clearInterval(interval);
    }, [isZenSession, token]);
}