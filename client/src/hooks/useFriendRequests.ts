import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './useCurrentUser';

export interface Friend {
    id: string;
    username: string;
    tag: string;
    avatarUrl: string | null;
    trustScore: number;
}

export interface FriendRequest {
    id: string;
    senderId: string;
    senderTag: string;
    name: string;
}

export type FriendRequestResult =
    | { status: 'success'; name?: string }
    | { status: 'not_found' }
    | { status: 'already_friends' }
    | { status: 'self' }
    | { status: 'error'; message: string };

export const useFriendRequests = () => {
    const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const fetchPendingRequests = useCallback(async () => {
        try {
            const data = await apiFetch(`/friends/requests`);
            setPendingRequests(data);
        } catch (error) {
            console.error('Failed to fetch friend requests:', error);
        }
    }, []);

    useEffect(() => {
        fetchPendingRequests();
        const interval = setInterval(fetchPendingRequests, 10000);
        return () => clearInterval(interval);
    }, [fetchPendingRequests]);

    const sendFriendRequest = async (searchTag: string): Promise<FriendRequestResult> => {
        const tag = searchTag.trim().replace(/^#/, '');
        if (!tag || tag.length < 2) {
            return { status: 'error', message: 'Invalid TAG.' };
        }

        setIsSearching(true);
        try {
            await apiFetch(`/friends/request`, {
                method: 'POST',
                body: JSON.stringify({ receiverTag: tag })
            });

            // If we don't crash, we've successfully sent the request.
            return { status: 'success' };
        } catch (err: any) {
            const msg: string = err?.message ?? '';

            if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
                return { status: 'not_found' };
            }
            if (msg.includes('Already friends')) {
                return { status: 'already_friends' };
            }
            if (msg.includes('yourself')) {
                return { status: 'self' };
            }
            return { status: 'error', message: 'An error occurred. Please try again.' };
        } finally {
            setIsSearching(false);
        }
    };

    const respondToRequest = async (id: string, action: 'accept' | 'reject') => {
        try {
            await apiFetch(`/friends/requests/${id}/respond`, {
                method: 'POST',
                body: JSON.stringify({ action })
            });

            setPendingRequests((prev) => prev.filter((req) => req.id !== id));
        } catch (err) {
            console.error(`Failed to ${action} request:`, err);
        }
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
        refreshRequests: fetchPendingRequests
    };
};

export const useAllFriends = () => {
    const [friends, setFriends] = useState<Friend[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchFriends = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await apiFetch(`/friends`);
            setFriends(data || []);
        } catch (error) {
            console.error('Failed to fetch all friends:', error);
            setFriends([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFriends();
    }, [fetchFriends]);

    return { friends, isLoading, refetchFriends: fetchFriends };
};