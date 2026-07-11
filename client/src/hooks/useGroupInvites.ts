import { useCallback, useEffect } from 'react';
import { apiFetch } from '../services/api';
import { GroupInvite, useSettingsStore } from '../store/useSettingsStore';

interface GroupInviteResponse extends GroupInvite {
    senderId: string;
    createdAt: string;
}

export function useGroupInvites() {
    const setPendingGroupInvites = useSettingsStore((state) => state.setPendingGroupInvites);
    const removePendingGroupInvite = useSettingsStore((state) => state.removePendingGroupInvite);

    const refreshGroupInvites = useCallback(async () => {
        try {
            const invites = await apiFetch('/group-invites') as GroupInviteResponse[];
            setPendingGroupInvites(Array.isArray(invites) ? invites : []);
        } catch (error) {
            console.error('Failed to load group invites:', error);
        }
    }, [setPendingGroupInvites]);

    useEffect(() => {
        refreshGroupInvites();
        const interval = setInterval(refreshGroupInvites, 10000);
        return () => clearInterval(interval);
    }, [refreshGroupInvites]);

    const acceptGroupInvite = useCallback(async (invite: GroupInvite) => {
        try {
            await apiFetch(`/groups/${invite.groupId}/join`, { method: 'POST' });
            removePendingGroupInvite(invite.id);
            return true;
        } catch (error) {
            console.error('Failed to accept group invite:', error);
            return false;
        }
    }, [removePendingGroupInvite]);

    const declineGroupInvite = useCallback(async (invite: GroupInvite) => {
        try {
            await apiFetch(`/group-invites/${invite.id}`, { method: 'DELETE' });
            removePendingGroupInvite(invite.id);
            return true;
        } catch (error) {
            console.error('Failed to decline group invite:', error);
            return false;
        }
    }, [removePendingGroupInvite]);

    return { refreshGroupInvites, acceptGroupInvite, declineGroupInvite };
}
