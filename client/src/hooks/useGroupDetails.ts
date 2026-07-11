import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { GroupMember, useSettingsStore } from '../store/useSettingsStore';

export interface GroupDetails {
    id: string;
    ownerId: string;
    status: 'draft' | 'active';
    members: GroupMember[];
    pending: GroupMember[];
}

export function useGroupDetails() {
    const activeGroupId = useSettingsStore((state) => state.activeGroupId);
    const setGroupMembers = useSettingsStore((state) => state.setGroupMembers);
    const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const refreshGroupDetails = useCallback(async () => {
        if (!activeGroupId) {
            setGroupDetails(null);
            setGroupMembers([]);
            return;
        }

        setIsLoading(true);
        try {
            const details = await apiFetch(`/groups/${activeGroupId}`) as GroupDetails;
            setGroupDetails(details);
            setGroupMembers(details.members || []);
        } catch (error) {
            console.error('Failed to load group details:', error);
        } finally {
            setIsLoading(false);
        }
    }, [activeGroupId, setGroupMembers]);

    useEffect(() => {
        refreshGroupDetails();
        const interval = setInterval(refreshGroupDetails, 5000);
        return () => clearInterval(interval);
    }, [refreshGroupDetails]);

    return { groupDetails, isLoading, refreshGroupDetails };
}
