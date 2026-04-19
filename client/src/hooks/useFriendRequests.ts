import { useState } from 'react';
import { apiFetch } from './useCurrentUser';
import { useSettingsStore } from '../store/useSettingsStore';

export interface FriendRequest {
    id: string;
    name: string;
}

export type FriendRequestResult =
    | { status: 'success'; name: string }
    | { status: 'not_found' }
    | { status: 'already_friends' }
    | { status: 'self' }
    | { status: 'error'; message: string };

export const useFriendRequests = () => {
    const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const userId = useSettingsStore((state) => state.userId);

    const sendFriendRequest = async (searchTag: string): Promise<FriendRequestResult> => {
        const tag = searchTag.trim().replace(/^#/, '');
        if (!tag || tag.length < 2) {
            return { status: 'error', message: 'Invalid TAG.' };
        }

        setIsSearching(true);
        try {
            const user = await apiFetch(`/users/search?tag=${encodeURIComponent(tag)}`);

            if (!user || !user.id) {
                return { status: 'not_found' };
            }

            if (user.id === userId) {
                return { status: 'self' };
            }

            const alreadyPending = pendingRequests.some((req) => req.id === user.id);
            if (alreadyPending) {
                return { status: 'already_friends' };
            }

            return { status: 'success', name: user.name || user.username };
        } catch (err: any) {
            const msg: string = err?.message ?? '';
            if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
                return { status: 'not_found' };
            }
            return { status: 'error', message: 'An error occurred. Please try again.' };
        } finally {
            setIsSearching(false);
        }
    };

    const respondToRequest = (id: string, action: 'accept' | 'reject') => {
        setPendingRequests((prev) => prev.filter((req) => req.id !== id));
    };

    const clearAllRequests = () => {
        setPendingRequests([]);
    };

    return {
        pendingRequests,
        isSearching,
        sendFriendRequest,
        respondToRequest,
        clearAllRequests,
    };
};