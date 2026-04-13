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

    console.log(`🚀 Trimit cerere la: ${url}`);

    const response = await fetch(url, {
        ...options,
        headers,
    });

    const responseText = await response.text();
    console.log(`📥 Serverul a răspuns cu: ${responseText}`);

    if (!response.ok) {
        throw new Error(responseText || 'Error from NightDrive server');
    }

    try {
        return JSON.parse(responseText);
    } catch (e) {
        console.error("❌ Eroare la parsare JSON. Serverul a trimis text, nu obiect.");
        throw new Error("Serverul nu a trimis un format JSON valid.");
    }
};