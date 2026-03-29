import { useEffect, useRef } from 'react';
import { API_BASE_URL } from '@env';
import { useSettings } from '../context/SettingsContext';

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
    userId: string | null,
    onInviteReceived: (data: InvitePayload) => void,
    onVoiceReceived: (data: VoicePayload) => void
) {
    const ws = useRef<WebSocket | null>(null);
    const { setGroupDestination, setRendezvousPoint } = useSettings();

    useEffect(() => {
        if (!userId) return;

        const wsUrl = API_BASE_URL.replace('http', 'ws').replace('https', 'wss') + `/api/ws?userId=${userId}`;
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
            }
        };

        return () => {
            if (ws.current) {
                ws.current.close();
            }
        };
    }, [userId, onInviteReceived, onVoiceReceived, setGroupDestination, setRendezvousPoint]);

    return { ws: ws.current };
}