import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { GroupSnapshot } from '../services/groupSession';
import { useSettingsStore } from '../store/useSettingsStore';

export type GroupDetails = GroupSnapshot;

export function useGroupDetails() {
    const activeGroupId = useSettingsStore((state) => state.activeGroupId);
    const draftGroupId = useSettingsStore((state) => state.draftGroupId);
    const setGroupMembers = useSettingsStore((state) => state.setGroupMembers);
    const setGroupOwnerId = useSettingsStore((state) => state.setGroupOwnerId);
    const setGroupVersion = useSettingsStore((state) => state.setGroupVersion);
    const setGroupDestination = useSettingsStore((state) => state.setGroupDestination);
    const setGroupStops = useSettingsStore((state) => state.setGroupStops);
    const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const currentGroupId = activeGroupId || draftGroupId;

    const refreshGroupDetails = useCallback(async (groupIdOverride?: string) => {
        const groupId = groupIdOverride || currentGroupId;
        if (!groupId) {
            setGroupDetails(null);
            setGroupMembers([]);
            setGroupStops([]);
            return;
        }

        setIsLoading(true);
        try {
            const details = await apiFetch(`/groups/${groupId}`) as GroupDetails;
            setGroupDetails(details);
            setGroupMembers(details.members || []);
            setGroupOwnerId(details.ownerId || null);
            setGroupVersion(details.version || 0);
            setGroupDestination(details.destination || null);
            setGroupStops(details.stops || []);
        } catch (error) {
            console.error('Failed to load group details:', error);
        } finally {
            setIsLoading(false);
        }
    }, [currentGroupId, setGroupDestination, setGroupMembers, setGroupOwnerId, setGroupStops, setGroupVersion]);

    useEffect(() => {
        refreshGroupDetails();
        const interval = setInterval(refreshGroupDetails, 5000);
        return () => clearInterval(interval);
    }, [refreshGroupDetails]);

    return { groupDetails, isLoading, refreshGroupDetails };
}
