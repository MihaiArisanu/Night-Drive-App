import { useEffect, useRef } from 'react';
import Toast from 'react-native-toast-message';
import { API_BASE_URL } from '@env';
import { useSettingsStore } from '../store/useSettingsStore';
import { apiFetch } from '../services/api';
import { notifySessionInvalidated } from '../services/sessionEvents';

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
                            draftGroupId,
                            userId,
                            setActiveGroupId,
                            setDraftGroupId,
                            setGroupOwnerId,
                            setGroupVersion,
                            setGroupDestination,
                            addGroupStop,
                            removeGroupStop,
                            setGroupMembers,
                            clearGroupState,
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
                                setGroupOwnerId(message.payload?.ownerId || null);
                                setGroupVersion(message.payload?.version || 0);
                                setGroupDestination(message.payload?.destination || null);
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
                                if (payload.newOwnerId) {
                                    setGroupOwnerId(payload.newOwnerId);
                                }
                                Toast.show({
                                    type: 'info',
                                    text1: payload.newOwnerId === userId ? 'You are now the group owner' : 'Group updated',
                                    text2: payload.newOwnerId === userId
                                        ? 'The previous owner left the ride group.'
                                        : 'A driver left the group.',
                                    position: 'top',
                                });
                            }
                        } else if (message.type === 'GROUP_CLOSED') {
                            const closedGroupId = message.payload?.groupId;
                            if (closedGroupId && (closedGroupId === activeGroupId || closedGroupId === draftGroupId)) {
                                clearGroupState();
                                Toast.show({
                                    type: 'info',
                                    text1: 'Group Ride ended',
                                    text2: 'The group owner closed the ride group.',
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
                        } else if (
                            message.type === 'session_invalidated'
                            || message.type === 'KICK_DUPLICATE'
                        ) {
                            notifySessionInvalidated(
                                message.message || 'Your account is now active on another device.',
                            );
                        } else if (message.type === 'GROUP_STOP_ADDED' || message.type === 'group_stop_added') {
                            const payload = message.payload;
                            const stopGroupId = payload?.groupId || message.group_id;
                            const stop = payload?.stop;
                            const currentVersion = useSettingsStore.getState().groupVersion;
                            if (
                                stopGroupId === activeGroupId
                                && payload?.appliesToCurrentUser !== false
                                && stop?.id
                                && typeof stop.latitude === 'number'
                                && typeof stop.longitude === 'number'
                                && (typeof payload.version !== 'number' || payload.version >= currentVersion)
                            ) {
                                addGroupStop(stop);
                                if (typeof payload.version === 'number') {
                                    setGroupVersion(payload.version);
                                }

                                Toast.show({
                                    type: 'info',
                                    text1: 'Route Updated!',
                                    text2: `${stop.name || 'A stop'} was added to the group route.`,
                                    position: 'top',
                                    visibilityTime: 4000,
                                });
                            }
                        } else if (message.type === 'GROUP_DESTINATION_UPDATED') {
                            const payload = message.payload;
                            const destinationGroupId = payload?.groupId;
                            const currentVersion = useSettingsStore.getState().groupVersion;
                            if (
                                destinationGroupId === activeGroupId
                                && payload?.destination
                                && typeof payload.destination.latitude === 'number'
                                && typeof payload.destination.longitude === 'number'
                                && (typeof payload.version !== 'number' || payload.version >= currentVersion)
                            ) {
                                setGroupDestination(payload.destination);
                                if (typeof payload.version === 'number') {
                                    setGroupVersion(payload.version);
                                }
                                Toast.show({
                                    type: 'info',
                                    text1: 'Group destination updated',
                                    text2: payload.destination.name || 'A new final destination was selected.',
                                    position: 'top',
                                    visibilityTime: 4000,
                                });
                            }
                        } else if (message.type === 'GROUP_STOP_CANCELLED') {
                            const payload = message.payload;
                            if (payload?.groupId === activeGroupId && payload?.stopId) {
                                removeGroupStop(payload.stopId);
                                if (typeof payload.version === 'number') {
                                    setGroupVersion(payload.version);
                                }
                                Toast.show({
                                    type: 'info',
                                    text1: 'Group stop cancelled',
                                    text2: 'The group owner removed this stop from the route.',
                                    position: 'top',
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
    }, [token, groupId]);
}
