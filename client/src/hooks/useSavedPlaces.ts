import { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';

export interface SavedPlace {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    created_at?: string;
}

export function useSavedPlaces() {
    const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
    const [isLoadingPlaces, setIsLoadingPlaces] = useState(true);

    const fetchSavedPlaces = async () => {
        try {
            const data = await apiFetch('/users/places');
            setSavedPlaces(data.places || []);
        } catch (error) {
            console.error("Failed to fetch saved places:", error);
        } finally {
            setIsLoadingPlaces(false);
        }
    };

    useEffect(() => {
        fetchSavedPlaces();
    }, []);

    const savePlace = async (name: string, latitude: number, longitude: number) => {
        try {
            await apiFetch('/users/places', {
                method: 'POST',
                body: JSON.stringify({ name, latitude, longitude })
            });
            await fetchSavedPlaces();
            return true;
        } catch (error) {
            console.error("Failed to save place:", error);
            return false;
        }
    };

    const updatePlace = async (id: string, name: string) => {
        try {
            await apiFetch(`/users/places/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name })
            });
            await fetchSavedPlaces();
            return true;
        } catch (error) {
            console.error("Failed to update place:", error);
            return false;
        }
    };

    const deletePlace = async (id: string) => {
        try {
            await apiFetch(`/users/places/${id}`, {
                method: 'DELETE'
            });
            await fetchSavedPlaces();
        } catch (error) {
            console.error("Failed to delete place:", error);
        }
    };

    return { savedPlaces, isLoadingPlaces, savePlace, updatePlace, deletePlace, refetchPlaces: fetchSavedPlaces };
}