import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';
import { check, PERMISSIONS, request, RESULTS } from 'react-native-permissions';
import { AudioSession } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent } from 'livekit-client';
import { apiFetch } from '../services/api';

const MAX_TRANSMISSION_MS = 10_000;

interface VoiceTokenResponse {
    serverUrl: string;
    participantToken: string;
}

export type VoiceToggleResult = 'started' | 'stopped' | 'not_ready' | 'permission_denied' | 'failed';

export function useGroupVoice(activeGroupId: string | null) {
    const roomRef = useRef<Room | null>(null);
    const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const transmittingRef = useRef(false);
    const operationInProgressRef = useRef(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isTransmitting, setIsTransmitting] = useState(false);

    const playCue = useCallback(() => {
        Vibration.vibrate(25);
    }, []);

    const stopTransmission = useCallback(async (playFeedback = true) => {
        if (stopTimerRef.current) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
        }
        const wasTransmitting = transmittingRef.current;
        transmittingRef.current = false;
        setIsTransmitting(false);
        const room = roomRef.current;
        if (room) {
            try {
                await room.localParticipant.setMicrophoneEnabled(false);
            } catch {
                // Local state is still reset; LiveKit also unpublishes on disconnect.
            }
        }
        if (wasTransmitting && playFeedback) playCue();
    }, [playCue]);

    useEffect(() => {
        if (!activeGroupId) {
            setIsConnected(false);
            return;
        }

        let cancelled = false;
        let room: Room | null = null;

        const scheduleRetry = () => {
            if (cancelled || retryTimerRef.current) return;
            retryTimerRef.current = setTimeout(() => {
                retryTimerRef.current = null;
                connect().catch(() => undefined);
            }, 5000);
        };

        const connect = async () => {
            try {
                const credentials = await apiFetch(`/groups/${activeGroupId}/voice-token`, {
                    method: 'POST',
                }) as VoiceTokenResponse;
                if (cancelled) return;

                await AudioSession.startAudioSession();
                room = new Room({ adaptiveStream: false, dynacast: false });
                roomRef.current = room;
                room.on(RoomEvent.Connected, () => {
                    if (!cancelled) setIsConnected(true);
                });
                room.on(RoomEvent.Reconnecting, () => {
                    if (!cancelled) setIsConnected(false);
                });
                room.on(RoomEvent.Reconnected, () => {
                    if (!cancelled) setIsConnected(true);
                });
                room.on(RoomEvent.Disconnected, () => {
                    if (cancelled) return;
                    setIsConnected(false);
                    stopTransmission(false).catch(() => undefined);
                    scheduleRetry();
                });

                await room.connect(credentials.serverUrl, credentials.participantToken, {
                    autoSubscribe: true,
                });
                await room.localParticipant.setMicrophoneEnabled(false);
                if (!cancelled) setIsConnected(room.state === ConnectionState.Connected);
            } catch {
                if (cancelled) return;
                setIsConnected(false);
                room?.removeAllListeners();
                room?.disconnect();
                if (roomRef.current === room) roomRef.current = null;
                scheduleRetry();
            }
        };

        connect().catch(() => undefined);
        return () => {
            cancelled = true;
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
            stopTransmission(false).catch(() => undefined);
            room?.removeAllListeners();
            room?.disconnect();
            if (roomRef.current === room) roomRef.current = null;
            setIsConnected(false);
            AudioSession.stopAudioSession().catch(() => undefined);
        };
    }, [activeGroupId, stopTransmission]);

    const ensureMicrophonePermission = useCallback(async () => {
        const permission = Platform.OS === 'ios'
            ? PERMISSIONS.IOS.MICROPHONE
            : PERMISSIONS.ANDROID.RECORD_AUDIO;
        const currentStatus = await check(permission);
        if (currentStatus === RESULTS.GRANTED) return true;
        return await request(permission) === RESULTS.GRANTED;
    }, []);

    const toggleTransmission = useCallback(async (): Promise<VoiceToggleResult> => {
        if (operationInProgressRef.current) return 'failed';
        if (transmittingRef.current) {
            operationInProgressRef.current = true;
            await stopTransmission(true);
            operationInProgressRef.current = false;
            return 'stopped';
        }

        const room = roomRef.current;
        if (!room || room.state !== ConnectionState.Connected) return 'not_ready';
        operationInProgressRef.current = true;
        try {
            if (!await ensureMicrophonePermission()) return 'permission_denied';
            playCue();
            await room.localParticipant.setMicrophoneEnabled(true, {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            });
            transmittingRef.current = true;
            setIsTransmitting(true);
            stopTimerRef.current = setTimeout(() => {
                stopTransmission(true).catch(() => undefined);
            }, MAX_TRANSMISSION_MS);
            return 'started';
        } catch {
            await stopTransmission(false);
            return 'failed';
        } finally {
            operationInProgressRef.current = false;
        }
    }, [ensureMicrophonePermission, playCue, stopTransmission]);

    return { isConnected, isTransmitting, toggleTransmission };
}
