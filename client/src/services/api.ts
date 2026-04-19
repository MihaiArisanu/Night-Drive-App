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

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = `${API_BASE_URL}/api${cleanEndpoint}`;

    console.log(`[API] Request: ${url}`);

    const response = await fetch(url, {
        ...options,
        headers,
    });

    const responseText = await response.text();
    console.log(`[API] Response: ${responseText}`);

    if (!response.ok) {
        throw new Error(responseText || 'Error from NightDrive server');
    }


    if (response.status === 204 || responseText.trim() === '') {
        return null;
    }

    try {
        return JSON.parse(responseText);
    } catch (e) {
        console.error("[API] JSON parse error. Server returned non-JSON response.");
        throw new Error("Server did not return a valid JSON response.");
    }
};