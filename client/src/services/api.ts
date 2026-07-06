import * as Keychain from 'react-native-keychain';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';

export const AuthStorage = {
    saveTokens: async (accessToken: string, refreshToken: string) => {
        await Keychain.setGenericPassword('tokens', JSON.stringify({ accessToken, refreshToken }));

        useSettingsStore.getState().setToken(accessToken);
    },

    getAccessToken: async () => {
        const credentials = await Keychain.getGenericPassword();
        if (credentials) {
            const tokens = JSON.parse(credentials.password);
            return tokens.accessToken;
        }
        return null;
    },

    getRefreshToken: async () => {
        const credentials = await Keychain.getGenericPassword();
        if (credentials) {
            const tokens = JSON.parse(credentials.password);
            return tokens.refreshToken;
        }
        return null;
    },

    clearTokens: async () => {
        await Keychain.resetGenericPassword();
        useSettingsStore.getState().clearSettings();
    },
};

let isRefreshing = false;
let failedQueue: { resolve: (token: string) => void, reject: (err: any) => void }[] = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach(prom => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token!);
        }
    });
    failedQueue = [];
};

export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    let token = useSettingsStore.getState().token;

    if (!token) {
        token = await AuthStorage.getAccessToken();
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers as Record<string, string>),
    };

    let url = `${API_BASE_URL}${endpoint}`;
    let response = await fetch(url, { ...options, headers });

    if (response.status === 401 && token) {
        if (isRefreshing) {
            try {
                const newToken = await new Promise<string>((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                });
                headers.Authorization = `Bearer ${newToken}`;
                return await fetch(url, { ...options, headers });
            } catch (err) {
                throw err;
            }
        } else {
            isRefreshing = true;
            try {
                const refreshToken = await AuthStorage.getRefreshToken();
                if (!refreshToken) throw new Error("No refresh token available");

                const refreshResponse = await fetch(`${API_BASE_URL}/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: refreshToken })
                });

                if (!refreshResponse.ok) {
                    throw new Error('Refresh Token invalid sau expirat.');
                }

                const refreshData = await refreshResponse.json();
                const newAccessToken = refreshData.access_token;
                const newRefreshToken = refreshData.refresh_token || refreshToken;

                await AuthStorage.saveTokens(newAccessToken, newRefreshToken);

                isRefreshing = false;
                processQueue(null, newAccessToken);

                headers.Authorization = `Bearer ${newAccessToken}`;
                response = await fetch(url, { ...options, headers });

            } catch (refreshErr) {
                isRefreshing = false;
                processQueue(refreshErr, null);
                await AuthStorage.clearTokens();
                throw new Error("Session expired. Please log in again.");
            }
        }
    }

    const responseText = await response.text();

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