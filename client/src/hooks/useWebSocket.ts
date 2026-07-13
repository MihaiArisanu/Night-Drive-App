import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';
import { useNavigation } from '@react-navigation/native';
import { apiFetch } from '../services/api';

interface InvitePayload {
    inviteId: string;
    senderId?: string;
    senderName?: string;
    friendName: string;
    distance: string;
    eta: string;
    groupId: string;
}

interface WebSocketTicketResponse {
    ticket: string;
    expiresIn: number;
}

export function useWebSocket(
    token: string | null,
    groupId: string | null,
    onInviteReceived: (data: InvitePayload) => void
) {
    const ws = useRef<WebSocket | null>(null);
    const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const navigation = useNavigation<any>();

    const inviteCallbackRef = useRef(onInviteReceived);
    useEffect(() => {
        inviteCallbackRef.current = onInviteReceived;
    }, [onInviteReceived]);

    useEffect(() => {
        if (!token) return;

        let cancelled = false;
        let activeSocket: WebSocket | null = null;

        const scheduleReconnect = () => {
            if (cancelled || reconnectTimeout.current) return;
            reconnectTimeout.current = setTimeout(() => {
                reconnectTimeout.current = null;
                connect();
            }, 5000);
        };

        const connect = async () => {
            try {
                const ticketResponse = await apiFetch('/auth/ws-ticket', {
                    method: 'POST',
                    body: JSON.stringify({ groupId: groupId || '' }),
                }) as WebSocketTicketResponse;
                if (cancelled) return;
                if (!ticketResponse?.ticket) {
                    throw new Error('WebSocket ticket missing');
                }

                const wsBaseUrl = API_BASE_URL
                    .replace(/^https:/, 'wss:')
                    .replace(/^http:/, 'ws:');
                const wsUrl = `${wsBaseUrl}/ws?ticket=${encodeURIComponent(ticketResponse.ticket)}`;
                const socket = new WebSocket(wsUrl);
                activeSocket = socket;
                ws.current = socket;

                socket.onopen = () => {
                    if (reconnectTimeout.current) {
                        clearTimeout(reconnectTimeout.current);
                        reconnectTimeout.current = null;
                    }
                };

                socket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);

                        const {
                            activeGroupId,
                            setActiveGroupId,
                            setDraftGroupId,
                            setGroupStop,
                            setGroupMembers,
                            clearSettings,
                            addPendingGroupInvite,
                            removePendingGroupInvite,
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
                            inviteCallbackRef.current(message.payload);
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
                        } else if (message.type === 'GROUP_MEMBER_LEFT') {
                            const payload = message.payload;
                            if (payload?.groupId === activeGroupId && payload?.userId) {
                                const currentMembers = useSettingsStore.getState().groupMembers;
                                setGroupMembers(currentMembers.filter((member) => member.id !== payload.userId));
                                Toast.show({
                                    type: 'info',
                                    text1: 'Group updated',
                                    text2: 'A driver left the group.',
                                    position: 'top',
                                });
                            }
                        } else if (message.type === 'GROUP_INVITE_CANCELLED') {
                            const cancelledGroupId = message.payload?.groupId;
                            if (cancelledGroupId) {
                                removePendingGroupInvite(cancelledGroupId);
                                Toast.show({
                                    type: 'info',
                                    text1: 'Invitation cancelled',
                                    text2: 'The ride group invitation is no longer available.',
                                    position: 'top',
                                });
                            }
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

                socket.onerror = () => {
                    socket.close();
                };

                socket.onclose = () => {
                    if (ws.current === socket) {
                        ws.current = null;
                    }
                    scheduleReconnect();
                };
            } catch {
                scheduleReconnect();
            }
        };

        connect();

        return () => {
            cancelled = true;
            if (reconnectTimeout.current) {
                clearTimeout(reconnectTimeout.current);
                reconnectTimeout.current = null;
            }
            if (activeSocket) {
                activeSocket.close();
            }
            if (ws.current === activeSocket) {
                ws.current = null;
            }
        };
    }, [token, groupId, navigation]);
}
