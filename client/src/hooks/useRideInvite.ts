import { useState } from 'react';
import { API_BASE_URL } from '@env';

export function useRideInvite() {
    const [isInviting, setIsInviting] = useState(false);

    const sendInvite = async (targetUserId: string, myName: string, myLat: number, myLng: number) => {
        setIsInviting(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/groups/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: targetUserId,
                    senderName: myName,
                    senderLat: myLat,
                    senderLng: myLng,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to send invite');
            }

            return { success: true };
        } catch (error) {
            return { success: false, error };
        } finally {
            setIsInviting(false);
        }
    };

    return { sendInvite, isInviting };
}