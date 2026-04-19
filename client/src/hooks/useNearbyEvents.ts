import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/api';

export interface TrafficEvent {
    id: string;
    type: 'police' | 'pothole' | 'accident';
    latitude: number;
    longitude: number;
    distance?: number;
}

export function useNearbyEvents(userLat: number | null, userLng: number | null) {
    const [events, setEvents] = useState<TrafficEvent[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchEvents = useCallback(async () => {
        if (userLat === null || userLng === null || isNaN(userLat) || isNaN(userLng)) {
            return;
        }

        setIsLoading(true);
        try {
            const radius = 20000;
            const limit = 50;

            const data = await apiFetch(
                `/events/nearby?lat=${userLat.toFixed(6)}&lng=${userLng.toFixed(6)}&radius=${radius}&limit=${limit}`
            );

            if (data && Array.isArray(data)) {
                setEvents(data);
            }
        } catch (error) {
            console.error("[Events] Fetch error:", error instanceof Error ? error.message : String(error));
        } finally {
            setIsLoading(false);
        }
    }, [userLat, userLng]);

    useEffect(() => {
        fetchEvents();
        const intervalId = setInterval(fetchEvents, 30000);
        return () => clearInterval(intervalId);
    }, [fetchEvents]);

    return { events, isLoading, refetchEvents: fetchEvents };
}