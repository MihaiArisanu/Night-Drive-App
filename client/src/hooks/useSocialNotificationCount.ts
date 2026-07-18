import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { subscribeToSocialNotificationChanges } from '../services/socialNotificationEvents';
import { useSettingsStore } from '../store/useSettingsStore';

interface SocialNotificationCount {
    total: number;
    friendRequests: number;
    groupInvites: number;
}

const emptyCount: SocialNotificationCount = {
    total: 0,
    friendRequests: 0,
    groupInvites: 0,
};

export function useSocialNotificationCount() {
    const token = useSettingsStore((state) => state.token);
    const [count, setCount] = useState<SocialNotificationCount>(emptyCount);

    const refresh = useCallback(async () => {
        if (!token) {
            setCount(emptyCount);
            return;
        }
        try {
            const response = await apiFetch('/notifications/count') as SocialNotificationCount;
            setCount({
                total: Math.max(0, response?.total || 0),
                friendRequests: Math.max(0, response?.friendRequests || 0),
                groupInvites: Math.max(0, response?.groupInvites || 0),
            });
        } catch (error) {
            console.warn('Could not refresh notification badge:', error);
        }
    }, [token]);

    useEffect(() => {
        refresh();
        if (!token) return undefined;

        const interval = setInterval(refresh, 15000);
        const subscription = subscribeToSocialNotificationChanges(refresh);
        return () => {
            clearInterval(interval);
            subscription.remove();
        };
    }, [refresh, token]);

    return { count, refresh };
}
