import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@env';

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
        if (!userLat || !userLng) return;

        setIsLoading(true);
        try {
            const radius = 20000;
            const limit = 50;

            const response = await fetch(
                `${API_BASE_URL}/api/events?lat=${userLat}&lng=${userLng}&radius=${radius}&limit=${limit}`
            );

            if (!response.ok) throw new Error('Failed to fetch events');

            const data = await response.json();

            if (data && Array.isArray(data)) {
                setEvents(data);
            }
        } catch (error) {
            console.error("Error fetching nearby events:", error);
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