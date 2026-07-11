import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';
import { useNavigation } from '@react-navigation/native';

interface InvitePayload {
    inviteId: string;
    senderId?: string;
    senderName?: string;
    friendName: string;
    distance: string;
    eta: string;
    groupId: string;
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
                if (reconnectTimeout.current) {
                    clearTimeout(reconnectTimeout.current);
                    reconnectTimeout.current = null;
                }
            };

            ws.current.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    const {
                        activeGroupId,
                        setActiveGroupId,
                        setDraftGroupId,
                        setGroupStop,
                        clearSettings,
                        addPendingGroupInvite,
                    } = useSettingsStore.getState();

                    if (message.type === 'RIDE_INVITE') {
                        const payload = message.payload as InvitePayload;
                        if (payload.inviteId && payload.groupId) {
                            addPendingGroupInvite({
                                id: payload.inviteId,
                                groupId: payload.groupId,
                                senderId: payload.senderId,
                                senderName: payload.senderName || payload.friendName || 'Driver',
                            });
                        }
                        callbacksRef.current.onInviteReceived(message.payload);
                    } else if (message.type === 'GROUP_INVITE_ACCEPTED') {
                        const acceptedGroupId = message.payload?.groupId;
                        if (acceptedGroupId) {
                            setActiveGroupId(acceptedGroupId);
                            setDraftGroupId(null);
                            Toast.show({
                                type: 'success',
                                text1: 'Group Ride started',
                                text2: 'Your invitation was accepted.',
                                position: 'top',
                            });
                        }
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

            ws.current.onerror = () => {
                ws.current?.close();
            };

            ws.current.onclose = () => {
                if (!isIntentionalClose.current) {
                    reconnectTimeout.current = setTimeout(() => {
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
    }, [token, groupId, navigation]);
}
