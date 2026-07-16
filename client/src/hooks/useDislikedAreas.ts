import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';

export interface DislikedArea {
    id: string;
    latitude: number;
    longitude: number;
    reason: string;
    coverage_type: 'area' | 'street' | 'segment' | 'polygon';
    street_name?: string;
    avoidance_radius_meters: number;
    paths?: Array<Array<{ latitude: number; longitude: number }>>;
    polygon?: Array<{ latitude: number; longitude: number }>;
    created_at?: string;
}

export function useDislikedAreas() {
    const [dislikedAreas, setDislikedAreas] = useState<DislikedArea[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDislikes = useCallback(async () => {
        try {
            const data = await apiFetch('/users/dislikes');
            setDislikedAreas(data.dislikes || []);
        } catch (error) {
            console.error("Failed to fetch dislikes:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useFocusEffect(useCallback(() => {
        fetchDislikes();
    }, [fetchDislikes]));

    const addDislike = async (
        latitude: number,
        longitude: number,
        reason: string,
        coverageType: 'area' | 'street' = 'street',
    ) => {
        try {
            await apiFetch('/users/dislikes', {
                method: 'POST',
                body: JSON.stringify({
                    latitude,
                    longitude,
                    reason,
                    coverage_type: coverageType,
                })
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

    const addDrawnZone = async (
        polygon: Array<{ latitude: number; longitude: number }>,
        reason: string,
    ) => {
        try {
            await apiFetch('/users/dislikes', {
                method: 'POST',
                body: JSON.stringify({
                    reason,
                    coverage_type: 'polygon',
                    polygon,
                }),
            });
            await fetchDislikes();
            return true;
        } catch (error) {
            console.error("Failed to add drawn avoidance zone:", error);
            return false;
        }
    };

    const removeDislike = async (id: string) => {
        try {
            await apiFetch(`/users/dislikes/${id}`, {
                method: 'DELETE'
            });
            await fetchDislikes();
            return true;
        } catch (error) {
            console.error("Failed to remove dislike:", error);
            return false;
        }
    };

    return {
        dislikedAreas,
        isLoading,
        addDislike,
        addDrawnZone,
        updateDislike,
        removeDislike,
        refetchDislikes: fetchDislikes,
    };
}
