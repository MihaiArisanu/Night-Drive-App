import { useState } from 'react';
import { apiFetch } from '../services/api';
import { useSettingsStore } from '../store/useSettingsStore';

export function useRideInvite() {
    const [isInviting, setIsInviting] = useState(false);

    const sendInvite = async (targetUserId: string, myName: string, myLat: number, myLng: number) => {
        setIsInviting(true);
        try {
            const {
                activeGroupId,
                draftGroupId,
                userId,
                setDraftGroupId,
                setGroupOwnerId,
            } = useSettingsStore.getState();
            const data = await apiFetch(`/groups/invite`, {
                method: 'POST',
                body: JSON.stringify({
                    targetUserId: targetUserId,
                    senderName: myName,
                    senderLat: myLat,
                    senderLng: myLng,
                    groupId: activeGroupId || draftGroupId || undefined,
                }),
            });

            if (!activeGroupId && data.groupId) {
                setDraftGroupId(data.groupId);
                if (!draftGroupId) {
                    setGroupOwnerId(userId);
                }
            }

            return { success: true, groupId: data.groupId };
        } catch (error) {
            return { success: false, error };
        } finally {
            setIsInviting(false);
        }
    };

    return { sendInvite, isInviting };
}
