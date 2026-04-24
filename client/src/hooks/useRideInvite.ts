import { useState } from 'react';
import { apiFetch } from './useCurrentUser';

export function useRideInvite() {
    const [isInviting, setIsInviting] = useState(false);

    const sendInvite = async (targetUserId: string, myName: string, myLat: number, myLng: number) => {
        setIsInviting(true);
        try {
            const data = await apiFetch(`/groups/invite`, {
                method: 'POST',
                body: JSON.stringify({
                    targetUserId: targetUserId,
                    senderName: myName,
                    senderLat: myLat,
                    senderLng: myLng,
                }),
            });

            return { success: true, groupId: data.groupId };
        } catch (error) {
            return { success: false, error };
        } finally {
            setIsInviting(false);
        }
    };

    return { sendInvite, isInviting };
}