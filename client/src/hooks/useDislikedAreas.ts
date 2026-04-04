import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@env';
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
            const response = await fetch(`${API_BASE_URL}/api/users/dislikes`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
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
            const response = await fetch(`${API_BASE_URL}/api/users/dislikes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ latitude, longitude, reason })
            });
            if (response.ok) {
                fetchDislikes();
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    };

    const removeDislike = async (id: string) => {
        if (!token) return false;
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/dislikes/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                fetchDislikes();
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    };

    return { dislikedAreas, isLoading, addDislike, removeDislike };
}