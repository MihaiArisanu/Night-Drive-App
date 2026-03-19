import { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';
export interface CurrentUser {
    name: string;
    tag: string;
}

export const useCurrentUser = () => {
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const data = await apiFetch('/users/me');
                setCurrentUser({
                    name: data.name,
                    tag: data.tag
                });
            } catch (error) {
                console.error("Eroare la preluarea datelor userului:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchUserData();
    }, []);

    return { currentUser, isLoading };
};