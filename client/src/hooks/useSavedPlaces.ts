import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';

export interface SavedPlace {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
}

export function useSavedPlaces() {
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { token } = useSettingsStore();

    const fetchSavedPlaces = useCallback(async () => {
        if (!token) return;
        setIsLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/places`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (data.places) {
                setSavedPlaces(data.places);
            }
        } catch (error) {
            console.error('Failed to fetch saved places:', error);
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchSavedPlaces();
    }, [fetchSavedPlaces]);

    const savePlace = async (name: string, latitude: number, longitude: number) => {
        if (!token) return false;
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/places`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, latitude, longitude })
            });

            if (response.ok) {
                await fetchSavedPlaces();
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    };

    return { savedPlaces, isLoadingPlaces: isLoading, savePlace };
}