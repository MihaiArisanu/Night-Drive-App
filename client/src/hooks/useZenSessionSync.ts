import { useEffect } from 'react';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';
import { decodePolyline } from '../utils/polyline';

export function useZenSessionSync(
    isZenSession: boolean,
    latitude: number,
    longitude: number,
    appendRoute: (newCoords: { latitude: number, longitude: number }[]) => void
) {
    const { token } = useSettingsStore();

    useEffect(() => {
        if (!isZenSession || latitude === 0) return;

        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/routes/zen/sync`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ latitude, longitude })
                });

                const data = await response.json();

                if (data.newPolylineChunk) {
                    const newCoordinates = decodePolyline(data.newPolylineChunk);
                    appendRoute(newCoordinates);
                }
            } catch (error) {
                console.log("ZenSession sync failed, retrying on next tick...");
            }
        }, 10000);

        return () => clearInterval(interval);
    }, [isZenSession, latitude, longitude, token]);
}