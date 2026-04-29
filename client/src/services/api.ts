import * as Keychain from 'react-native-keychain';
import { API_BASE_URL } from '@env';

export const AuthStorage = {
    saveTokens: async (accessToken: string, refreshToken: string) => {
        await Keychain.setGenericPassword('tokens', JSON.stringify({ accessToken, refreshToken }));
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
    const token = await AuthStorage.getAccessToken();

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers as Record<string, string>),
    };

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = `${API_BASE_URL}${cleanEndpoint}`;
    console.log(`[API] Request: ${url}`);

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        console.log(`[API] 401 Unauthorized at ${cleanEndpoint}. Trying Refresh...`);

        const refreshToken = await AuthStorage.getRefreshToken();

        if (!refreshToken) {
            await AuthStorage.clearTokens();
            throw new Error("Session expired. Please log in again.");
        }

        if (isRefreshing) {
            try {
                const newToken = await new Promise<string>((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                });
                headers.Authorization = `Bearer ${newToken}`;
                response = await fetch(url, { ...options, headers });
            } catch (err) {
                throw err;
            }
        } else {
            isRefreshing = true;
            try {
                const refreshUrl = `${API_BASE_URL}/auth/refresh`;
                const refreshResponse = await fetch(refreshUrl, {
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