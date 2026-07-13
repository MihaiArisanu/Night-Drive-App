import { useState, useEffect, useCallback } from 'react';
import { ApiError, apiFetch } from '../services/api';

export interface Friend {
    id: string;
    username: string;
    tag: string;
    profile_picture_url?: string;
    trust_score: number;
}

export interface FriendRequest {
    id: string;
    senderId: string;
    senderTag: string;
    name: string;
}

export type FriendRequestResult =
    | { status: 'success'; name: string }
    | { status: 'friendship_repaired'; name: string }
    | { status: 'not_found' }
    | { status: 'already_friends' }
    | { status: 'already_pending' }
    | { status: 'incoming_pending' }
    | { status: 'self' }
    | { status: 'error'; message: string };

interface SendFriendRequestResponse {
    success: boolean;
    status: 'created' | 'friendship_repaired';
    name?: string;
    recipient?: {
        id: string;
        name: string;
        tag: string;
    };
}

const readApiError = (error: unknown): { code: string; message: string } => {
    if (error instanceof ApiError) {
        return { code: error.code, message: error.message };
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    try {
        const parsed = JSON.parse(rawMessage) as { error?: string; message?: string };
        return {
            code: parsed.error ?? '',
            message: parsed.message ?? rawMessage,
        };
    } catch {
        return { code: '', message: rawMessage };
    }
};

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
        if (!tag || tag.length < 4) {
            return { status: 'error', message: 'Invalid TAG.' };
        }

        setIsSearching(true);
        try {
            const data = await apiFetch(`/friends/request`, {
                method: 'POST',
                body: JSON.stringify({ receiverTag: tag })
            }) as SendFriendRequestResponse;

            if (!data.success || !['created', 'friendship_repaired'].includes(data.status)) {
                return { status: 'error', message: 'The server returned an invalid response.' };
            }

            const recipientName = data.recipient?.name?.trim() || data.name?.trim() || `#${tag}`;
            if (data.status === 'friendship_repaired') {
                return { status: 'friendship_repaired', name: recipientName };
            }
            return { status: 'success', name: recipientName };
        } catch (error: unknown) {
            const apiError = readApiError(error);

            if (apiError.code === 'user_not_found' || apiError.message.toLowerCase().includes('not found')) {
                return { status: 'not_found' };
            }
            if (apiError.code === 'already_friends') {
                return { status: 'already_friends' };
            }
            if (apiError.code === 'friend_request_pending') {
                return { status: 'already_pending' };
            }
            if (apiError.code === 'incoming_friend_request_pending') {
                return { status: 'incoming_pending' };
            }
            if (apiError.code === 'self_request') {
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
            return true;
        } catch (error) {
            console.error(`Failed to ${action} request:`, error);
            return false;
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
