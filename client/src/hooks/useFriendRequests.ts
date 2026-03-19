import { useState } from 'react';

export interface FriendRequest {
    id: string;
    name: string;
}

export const useFriendRequests = () => {
    const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const sendFriendRequest = (searchTag: string, onSuccess: () => void) => {
        if (!searchTag.trim()) return;

        setIsSearching(true);
        setTimeout(() => {
            console.log(`Cerere trimisă către: ${searchTag}`);
            setIsSearching(false);
            onSuccess();
        }, 1000);
    };

    const respondToRequest = (id: string, action: 'accept' | 'reject') => {
        console.log(`Ai dat ${action} la cererea ${id}`);
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
        clearAllRequests
    };
};