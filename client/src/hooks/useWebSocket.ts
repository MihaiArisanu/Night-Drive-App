import { useEffect, useRef } from 'react';
import Toast from 'react-native-toast-message';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';

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
    const { setGroupDestination, setRendezvousPoint } = useSettingsStore();

    useEffect(() => {
        if (!token) return;

        let wsUrl = API_BASE_URL.replace('http', 'ws').replace('https', 'wss') + `/api/ws?token=${token}`;

        if (groupId) {
            wsUrl += `&groupId=${groupId}`;
        }

        ws.current = new WebSocket(wsUrl);

        ws.current.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'RIDE_INVITE' && message.payload) {
                    onInviteReceived(message.payload);
                }

                if (message.type === 'ROUTE_SYNC' && message.payload) {
                    const payload = message.payload as RouteSyncPayload;
                    setGroupDestination(payload.finalDestination);
                    if (payload.rendezvousPoint) {
                        setRendezvousPoint(payload.rendezvousPoint);
                    }
                }

                if (message.type === 'VOICE_MESSAGE' && message.payload) {
                    onVoiceReceived(message.payload);
                }
            } catch (error) {
                console.error('WebSocket JSON parsing error:', error);
            }
        };

        return () => {
            if (ws.current) {
                ws.current.close();
            }
        };
    }, [token, groupId, onInviteReceived, onVoiceReceived, setGroupDestination, setRendezvousPoint]);

    return { ws: ws.current };
}

export function useGroupStopListener(socket: WebSocket | null) {
    const { activeGroupId, setGroupStop } = useSettingsStore();

    useEffect(() => {
        if (!socket) return;

        const handleWebSocketMessage = (event: WebSocketMessageEvent) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'group_stop_added') {

                    if (data.group_id === activeGroupId) {
                        console.log("Nouă oprire de grup primită:", data.payload);
                        setGroupStop({
                            latitude: data.payload.latitude,
                            longitude: data.payload.longitude,
                            name: data.payload.name
                        });

                        Toast.show({
                            type: 'info',
                            text1: 'Route Updated! 🛑',
                            text2: `${data.payload.name} added as a group stop.`,
                            position: 'top',
                            visibilityTime: 4000,
                        });
                    }
                }
            } catch (error) {
                console.error("Eroare la parsarea mesajului WS:", error);
            }
        };

        socket.addEventListener('message', handleWebSocketMessage);

        return () => {
            socket.removeEventListener('message', handleWebSocketMessage);
        };
    }, [socket, activeGroupId]);
}