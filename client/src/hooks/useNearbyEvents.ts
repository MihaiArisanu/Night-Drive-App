import { useState, useEffect, useCallback } from 'react';
// 1. Importăm apiFetch în loc de fetch-ul nativ
import { apiFetch } from '../services/api'; // Ajustează calea către api.ts-ul tău

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
        // Verificăm strict dacă avem numere
        if (userLat === null || userLng === null || isNaN(userLat) || isNaN(userLng)) {
            console.log("⏳ Așteptăm coordonate valide...");
            return;
        }

        setIsLoading(true);
        try {
            const radius = 20000;
            const limit = 50;

            // Folosim apiFetch și curățăm parametrii
            const data = await apiFetch(
                `/events/nearby?lat=${userLat.toFixed(6)}&lng=${userLng.toFixed(6)}&radius=${radius}&limit=${limit}`
            );

            if (data && Array.isArray(data)) {
                setEvents(data);
                console.log(`✅ Am descărcat ${data.length} evenimente.`);
            }
        } catch (error) {
            // Aici vor apărea erorile de tip "401" sau "500" într-un format lizibil
            console.error("❌ Eroare la fetchEvents:", error instanceof Error ? error.message : String(error));
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