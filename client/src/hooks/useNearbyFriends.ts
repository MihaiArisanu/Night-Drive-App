import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@env';

export interface FriendLocation {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    heading: number;
}

export function useNearbyFriends(userLat: number | null, userLng: number | null, isDNDActive: boolean, token: string | null) {
    const [friends, setFriends] = useState<FriendLocation[]>([]);

    const fetchFriends = useCallback(async () => {
        if (!userLat || !userLng || isDNDActive || !token) {
            setFriends([]);
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/friends/nearby?lat=${userLat}&lng=${userLng}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Failed to fetch friends');

            const data = await response.json();
            if (data && Array.isArray(data)) {
                setFriends(data);
            }
        } catch (error) {
        }
    }, [userLat, userLng, isDNDActive, token]);

    useEffect(() => {
        fetchFriends();
        const intervalId = setInterval(fetchFriends, 10000);
        return () => clearInterval(intervalId);
    }, [fetchFriends]);

    return { friends };
}