import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';
import { useNavigation } from '@react-navigation/native';

interface InvitePayload {
    friendName: string;
    distance: string;
    eta: string;
    groupId: string;
}

interface RouteSyncPayload {
    finalDestination: { latitude: number; longitude: number; name?: string };
    rendezvousPoint?: { latitude: number; longitude: number };
}

interface VoicePayload {
    audioUrl: string;
    senderName: string;
}

export function useWebSocket(
    token: string | null,
    groupId: string | null,
    onInviteReceived: (data: InvitePayload) => void,
    onVoiceReceived: (data: VoicePayload) => void
) {
    const ws = useRef<WebSocket | null>(null);
    const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isIntentionalClose = useRef<boolean>(false);
    const navigation = useNavigation<any>();

    const callbacksRef = useRef({ onInviteReceived, onVoiceReceived });
    useEffect(() => {
        callbacksRef.current = { onInviteReceived, onVoiceReceived };
    }, [onInviteReceived, onVoiceReceived]);

    useEffect(() => {
        if (!token) return;

        isIntentionalClose.current = false;

        const connect = () => {
            let wsUrl = API_BASE_URL.replace('http', 'ws').replace('https', 'wss') + `/ws?token=${token}`;

            if (groupId) {
                wsUrl += `&groupId=${groupId}`;
            }

            ws.current = new WebSocket(wsUrl);

            ws.current.onopen = () => {
                console.log("[WebSocket] Connected.");
                if (reconnectTimeout.current) {
                    clearTimeout(reconnectTimeout.current);
                    reconnectTimeout.current = null;
                }
            };

            ws.current.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    const { activeGroupId, setGroupStop, clearSettings } = useSettingsStore.getState();

                    if (message.type === 'RIDE_INVITE') {
                        callbacksRef.current.onInviteReceived(message.payload);
                    } else if (message.type === 'VOICE_MESSAGE') {
                        callbacksRef.current.onVoiceReceived(message.payload);
                    } else if (message.type === 'KICK_DUPLICATE') {
                        Alert.alert(
                            "Session Terminated",
                            "Your account was logged in from another device. This session will be closed.",
                            [{
                                text: "OK", onPress: () => {
                                    clearSettings();
                                    navigation.replace('Welcome');
                                }
                            }]
                        );
                    } else if (message.type === 'group_stop_added') {
                        if (message.group_id === activeGroupId) {
                            console.log("New group stop:", message.payload);
                            setGroupStop({
                                latitude: message.payload.latitude,
                                longitude: message.payload.longitude,
                                name: message.payload.name
                            });

                            Toast.show({
                                type: 'info',
                                text1: 'Route Updated!',
                                text2: `${message.payload.name} added as a group stop.`,
                                position: 'top',
                                visibilityTime: 4000,
                            });
                        }
                    }
                } catch (error) {
                    console.error("[WebSocket] Eroare la parsarea mesajului:", error);
                }
            };

            ws.current.onerror = (err) => {
                console.log('[WebSocket] Connection error. Closing...');
                ws.current?.close();
            };

            ws.current.onclose = (e) => {
                console.log('[WebSocket] Connection closed.');

                if (!isIntentionalClose.current) {
                    reconnectTimeout.current = setTimeout(() => {
                        console.log('[WebSocket] Reconnecting...');
                        connect();
                    }, 5000);
                }
            };
        };

        connect();

        return () => {
            isIntentionalClose.current = true;
            if (reconnectTimeout.current) {
                clearTimeout(reconnectTimeout.current);
            }
            if (ws.current) {
                ws.current.close();
            }
        };
    }, [token, groupId]);
}