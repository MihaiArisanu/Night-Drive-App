import { useEffect, useRef } from 'react';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';

interface TelemetryPoint {
    latitude: number;
    longitude: number;
    speed: number;
    recordedAt: string;
}

export function useTelemetry(latitude: number, longitude: number, speedMs: number) {
    const { token } = useSettingsStore();
    const buffer = useRef<TelemetryPoint[]>([]);

    useEffect(() => {
        if (latitude === 0 || longitude === 0 || speedMs < 1.5) {
            return;
        }

        buffer.current.push({
            latitude,
            longitude,
            speed: speedMs * 3.6,
            recordedAt: new Date().toISOString(),
        });

        if (buffer.current.length >= 20) {
            sendBatch(buffer.current);
            buffer.current = [];
        }
    }, [latitude, longitude, speedMs, token]);

    const sendBatch = async (dataBatch: TelemetryPoint[]) => {
        if (!token) return;
        try {
            await fetch(`${API_BASE_URL}/api/locations/history`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dataBatch)
            });
        } catch (error) {
            console.log("Telemetry batch failed, skipping...");
        }
    };
}