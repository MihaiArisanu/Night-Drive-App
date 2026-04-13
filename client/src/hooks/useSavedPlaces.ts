import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/api';
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
            const data = await apiFetch('/users/places');
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
            await apiFetch('/users/places', {
                method: 'POST',
                body: JSON.stringify({ name, latitude, longitude })
            });
            // Dacă ajunge aici, request-ul a fost cu succes
            await fetchSavedPlaces();
            return true;
        } catch (error) {
            console.error('Failed to save place:', error);
            return false;
        }
    };

    const deletePlace = async (id: string) => {
        if (!token) return false;
        try {
            await apiFetch(`/users/places/${id}`, {
                method: 'DELETE'
            });
            await fetchSavedPlaces();
            return true;
        } catch (error) {
            console.error('Failed to delete place:', error);
            return false;
        }
    };

    return { savedPlaces, isLoadingPlaces: isLoading, savePlace, deletePlace };
}