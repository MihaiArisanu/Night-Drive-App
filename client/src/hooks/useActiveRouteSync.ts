import { useEffect } from 'react';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';

function encodePolyline(coordinates: { latitude: number; longitude: number }[]) {
    let result = '';
    let prevLat = 0;
    let prevLng = 0;

    for (let i = 0; i < coordinates.length; i++) {
        let lat = Math.round(coordinates[i].latitude * 1e5);
        let lng = Math.round(coordinates[i].longitude * 1e5);

        let dLat = lat - prevLat;
        let dLng = lng - prevLng;

        prevLat = lat;
        prevLng = lng;

        const encode = (val: number) => {
            val = val < 0 ? ~(val << 1) : val << 1;
            let chunk = '';
            while (val >= 0x20) {
                chunk += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
                val >>= 5;
            }
            chunk += String.fromCharCode(val + 63);
            return chunk;
        };

        result += encode(dLat) + encode(dLng);
    }
    return result;
}

export function useActiveRouteSync(routeCoordinates: { latitude: number; longitude: number }[], isNavigating: boolean) {
    const { token } = useSettingsStore();

    useEffect(() => {
        if (!token || !isNavigating || routeCoordinates.length === 0) return;

        const syncRoute = async () => {
            try {
                const polylineString = encodePolyline(routeCoordinates);

                await fetch(`${API_BASE_URL}/routes/active`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ polyline: polylineString })
                });
            } catch (error) {
                console.log("Failed to sync active route:", error);
            }
        };

        syncRoute();
    }, [isNavigating, routeCoordinates, token]);
}