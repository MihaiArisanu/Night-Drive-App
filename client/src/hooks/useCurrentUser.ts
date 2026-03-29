import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/api';

export interface CurrentUser {
    name: string;
    tag: string;
    email: string;
}

export const useCurrentUser = () => {
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchUserData = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await apiFetch('/users/me');
            setCurrentUser({
                name: data.name,
                tag: data.tag,
                email: data.email
            });
        } catch (error) {
            console.error("Eroare la preluarea datelor userului:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUserData();
    }, [fetchUserData]);

    return { currentUser, isLoading, refetchUser: fetchUserData };
};