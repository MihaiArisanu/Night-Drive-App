import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/api';
import { useSettingsStore } from '../store/useSettingsStore';

export interface DislikedArea {
    id: string;
    latitude: number;
    longitude: number;
    reason: string;
}

export function useDislikedAreas() {
    const [dislikedAreas, setDislikedAreas] = useState<DislikedArea[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { token } = useSettingsStore();

    const fetchDislikes = useCallback(async () => {
        if (!token) return;
        setIsLoading(true);
        try {
            // apiFetch adaugă automat token-ul și parsează JSON-ul
            const data = await apiFetch('/users/dislikes');
            if (data.dislikes) setDislikedAreas(data.dislikes);
        } catch (error) {
            console.error('Failed to fetch dislikes:', error);
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchDislikes();
    }, [fetchDislikes]);

    const addDislike = async (latitude: number, longitude: number, reason: string) => {
        if (!token) return false;
        try {
            await apiFetch('/users/dislikes', {
                method: 'POST',
                body: JSON.stringify({ latitude, longitude, reason })
            });
            // Dacă apiFetch nu dă throw, înseamnă că request-ul a fost OK (status 200)
            fetchDislikes();
            return true;
        } catch (error) {
            console.error('Failed to add dislike:', error);
            return false;
        }
    };

    const removeDislike = async (id: string) => {
        if (!token) return false;
        try {
            await apiFetch(`/users/dislikes/${id}`, {
                method: 'DELETE'
            });
            fetchDislikes();
            return true;
        } catch (error) {
            console.error('Failed to remove dislike:', error);
            return false;
        }
    };

    return { dislikedAreas, isLoading, addDislike, removeDislike };
}