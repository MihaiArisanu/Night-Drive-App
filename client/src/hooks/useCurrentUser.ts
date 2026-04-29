import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';

export interface CurrentUser {
    name: string;
    tag: string;
    email: string;
}

export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const token = useSettingsStore.getState().token;

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
            ...options.headers,
        },
    });

    const text = await response.text();

    if (!response.ok) {
        let errorMessage = text;
        try {
            const parsed = JSON.parse(text);
            if (parsed.message) errorMessage = parsed.message;
        } catch (e) { }
        throw new Error(`API Error ${response.status}: ${errorMessage}`);
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error(`JSON Parse error on 200 OK. Raw text: "${text}"`);
    }
};

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
            useSettingsStore.getState().setUserName(data.name);
            useSettingsStore.getState().setUserId(data.id);
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