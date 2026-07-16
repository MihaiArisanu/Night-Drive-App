import * as Keychain from 'react-native-keychain';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';
import { notifySessionInvalidated } from './sessionEvents';
import { identifyCrashReportingUser } from './crashReporting';

interface ApiFetchOptions extends RequestInit {
    skipAuthentication?: boolean;
}

export interface ApiErrorBody {
    error?: string;
    message?: string;
    challenge?: string;
    expires_in?: number;
    [key: string]: unknown;
}

export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly payload: ApiErrorBody | null;

    constructor(status: number, code: string, message: string, payload: ApiErrorBody | null = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.payload = payload;
    }
}

const DEVICE_ID_KEYCHAIN_SERVICE = 'com.nightdrive.device-identity';

const createDeviceId = () => (
    `nightdrive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
);

export const DeviceIdentity = {
    getOrCreate: async () => {
        const existing = await Keychain.getGenericPassword({
            service: DEVICE_ID_KEYCHAIN_SERVICE,
        });
        if (existing && existing.password) {
            return existing.password;
        }

        const deviceId = createDeviceId();
        await Keychain.setGenericPassword('device', deviceId, {
            service: DEVICE_ID_KEYCHAIN_SERVICE,
        });
        return deviceId;
    },
};

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
        await identifyCrashReportingUser(null);
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

const readErrorBody = async (response: Response): Promise<ApiErrorBody | null> => {
    try {
        return await response.clone().json() as ApiErrorBody;
    } catch {
        return null;
    }
};

const isReplacedSession = (errorBody: ApiErrorBody | null) => (
    errorBody?.error === 'session_replaced' || errorBody?.error === 'account_deleted'
);

export const apiFetch = async (endpoint: string, options: ApiFetchOptions = {}) => {
    const { skipAuthentication = false, ...requestOptions } = options;
    let token = skipAuthentication ? null : useSettingsStore.getState().token;

    if (!skipAuthentication && !token) {
        token = await AuthStorage.getAccessToken();
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(requestOptions.headers as Record<string, string>),
    };

    let url = `${API_BASE_URL}${endpoint}`;
    let response = await fetch(url, { ...requestOptions, headers });

    if (response.status === 401 && token) {
        const authErrorBody = await readErrorBody(response);
        if (isReplacedSession(authErrorBody)) {
            const message = authErrorBody?.message || 'Your account is now active on another device.';
            notifySessionInvalidated(message);
            throw new ApiError(
                response.status,
                authErrorBody?.error || 'session_replaced',
                message,
                authErrorBody,
            );
        }

        if (isRefreshing) {
            try {
                const newToken = await new Promise<string>((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                });
                headers.Authorization = `Bearer ${newToken}`;
                response = await fetch(url, { ...requestOptions, headers });
            } catch (err) {
                throw err;
            }
        } else {
            isRefreshing = true;
            try {
                const refreshToken = await AuthStorage.getRefreshToken();
                if (!refreshToken) throw new Error("No refresh token available");

                const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: refreshToken })
                });

                if (!refreshResponse.ok) {
                    const refreshErrorBody = await readErrorBody(refreshResponse);
                    const message = refreshErrorBody?.message || 'Your session expired. Please log in again.';
                    if (isReplacedSession(refreshErrorBody)) {
                        notifySessionInvalidated(message);
                    }
                    throw new ApiError(
                        refreshResponse.status,
                        refreshErrorBody?.error || 'refresh_failed',
                        message,
                        refreshErrorBody,
                    );
                }

                const refreshData = await refreshResponse.json();
                const newAccessToken = refreshData.access_token;
                const newRefreshToken = refreshData.refresh_token || refreshToken;

                await AuthStorage.saveTokens(newAccessToken, newRefreshToken);

                isRefreshing = false;
                processQueue(null, newAccessToken);

                headers.Authorization = `Bearer ${newAccessToken}`;
                response = await fetch(url, { ...requestOptions, headers });

            } catch (refreshErr) {
                isRefreshing = false;
                processQueue(refreshErr, null);
                await AuthStorage.clearTokens();
                if (refreshErr instanceof ApiError) {
                    throw refreshErr;
                }
                throw new Error("Session expired. Please log in again.");
            }
        }
    }

    const responseText = await response.text();

    if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const isHtmlResponse = contentType.includes('text/html') || /^\s*<(?:!doctype|html)/i.test(responseText);
        if (isHtmlResponse) {
            throw new ApiError(
                response.status,
                'service_unavailable',
                'NightDrive service is temporarily unavailable. Please try again.',
            );
        }

        let errorBody: ApiErrorBody | null = null;
        try {
            errorBody = JSON.parse(responseText) as ApiErrorBody;
        } catch {
            // Some upstream failures can still return plain text.
        }

        if (isReplacedSession(errorBody)) {
            notifySessionInvalidated(
                errorBody?.message || 'Your account is now active on another device.',
            );
        }

        throw new ApiError(
            response.status,
            errorBody?.error || 'api_error',
            errorBody?.message || responseText || 'NightDrive could not complete the request.',
            errorBody,
        );
    }

    if (response.status === 204 || responseText.trim() === '') {
        return null;
    }

    try {
        return JSON.parse(responseText);
    } catch {
        console.error("[API] JSON parse error. Server returned non-JSON response.");
        throw new Error("Server did not return a valid JSON response.");
    }
};

const urlTimestamps: Record<string, number> = {};

export const getAvatarUrl = (url: string | undefined | null) => {
    if (!url) return null;

    const apiOrigin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
    const avatarMarker = '/avatars/';
    const markerIndex = url.lastIndexOf(avatarMarker);

    let fullUrl: string;
    if (markerIndex >= 0) {
        const objectName = url
            .slice(markerIndex + avatarMarker.length)
            .split(/[?#]/, 1)[0];
        fullUrl = `${API_BASE_URL}/avatars/${encodeURIComponent(objectName)}`;
    } else if (url.startsWith('/')) {
        fullUrl = `${apiOrigin}${url}`;
    } else {
        fullUrl = url;
    }

    if (!urlTimestamps[fullUrl]) {
        urlTimestamps[fullUrl] = Date.now();
    }

    return `${fullUrl}?t=${urlTimestamps[fullUrl]}`;
};

export const getAvatarSource = (url: string | undefined | null) => {
    const uri = getAvatarUrl(url);
    if (!uri) return null;

    return { uri };
};
