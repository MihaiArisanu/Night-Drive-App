import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/api';

export interface FriendLocation {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    heading: number;
    profile_picture_url?: string;
}

export function useNearbyFriends(
    userLat: number | null,
    userLng: number | null,
    token: string | null,
    activeGroupId: string | null,
) {
    const [friends, setFriends] = useState<FriendLocation[]>([]);

    const fetchFriends = useCallback(async () => {
        if (!userLat || !userLng || !token) {
            setFriends([]);
            return;
        }

        try {
            const groupQuery = activeGroupId ? `?groupId=${encodeURIComponent(activeGroupId)}` : '';
            const data = await apiFetch(`/friends/nearby${groupQuery}`);
            if (data && Array.isArray(data)) {
                setFriends(data);
            }
        } catch {
        }
    }, [userLat, userLng, token, activeGroupId]);

    useEffect(() => {
        fetchFriends();
        const intervalId = setInterval(fetchFriends, 10000);
        return () => clearInterval(intervalId);
    }, [fetchFriends]);

    return { friends };
}
