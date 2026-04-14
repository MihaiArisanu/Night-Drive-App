import { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';

export interface DislikedArea {
    id: string;
    latitude: number;
    longitude: number;
    reason: string;
    created_at?: string;
}

export function useDislikedAreas() {
    const [dislikedAreas, setDislikedAreas] = useState<DislikedArea[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDislikes = async () => {
        try {
            const data = await apiFetch('/users/dislikes');
            setDislikedAreas(data.dislikes || []);
        } catch (error) {
            console.error("Failed to fetch dislikes:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDislikes();
    }, []);

    const addDislike = async (latitude: number, longitude: number, reason: string) => {
        try {
            await apiFetch('/users/dislikes', {
                method: 'POST',
                body: JSON.stringify({ latitude, longitude, reason })
            });
            await fetchDislikes();
            return true;
        } catch (error) {
            console.error("Failed to add dislike:", error);
            return false;
        }
    };

    const updateDislike = async (id: string, reason: string) => {
        try {
            await apiFetch(`/users/dislikes/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ reason })
            });
            await fetchDislikes();
            return true;
        } catch (error) {
            console.error("Failed to update dislike:", error);
            return false;
        }
    };

    const removeDislike = async (id: string) => {
        try {
            await apiFetch(`/users/dislikes/${id}`, {
                method: 'DELETE'
            });
            await fetchDislikes();
        } catch (error) {
            console.error("Failed to remove dislike:", error);
        }
    };

    return { dislikedAreas, isLoading, addDislike, updateDislike, removeDislike, refetchDislikes: fetchDislikes };
}