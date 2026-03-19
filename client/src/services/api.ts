import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '@env';

export const AuthStorage = {
    saveToken: async (token: string) => await AsyncStorage.setItem('jwt_token', token),
    getToken: async () => await AsyncStorage.getItem('jwt_token'),
    removeToken: async () => await AsyncStorage.removeItem('jwt_token'),
};

export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const token = await AuthStorage.getToken();

    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = errorText;

        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.message || errorText;
        } catch (e) {
        }

        throw new Error(errorMessage || 'Error from NightDrive server');
    }

    return response.json();
};