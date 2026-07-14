import { apiFetch } from './api';
import { GroupMember, GroupStop, LocationPoint, useSettingsStore } from '../store/useSettingsStore';

export interface GroupSnapshot {
    id: string;
    ownerId: string;
    status: 'draft' | 'active';
    version: number;
    destination: LocationPoint | null;
    stops: GroupStop[];
    members: GroupMember[];
    pending: GroupMember[];
}

export function applyGroupSnapshot(snapshot: GroupSnapshot | null) {
    const settings = useSettingsStore.getState();
    if (!snapshot) {
        settings.clearGroupState();
        return;
    }

    settings.setGroupMembers(snapshot.members || []);
    settings.setGroupOwnerId(snapshot.ownerId || null);
    settings.setGroupVersion(snapshot.version || 0);
    settings.setGroupDestination(snapshot.destination || null);
    settings.setGroupStops(snapshot.stops || []);
    if (snapshot.status === 'active') {
        settings.setActiveGroupId(snapshot.id);
        settings.setDraftGroupId(null);
    } else {
        settings.setActiveGroupId(null);
        settings.setDraftGroupId(snapshot.id);
    }
}

export async function restoreCurrentGroup() {
    const snapshot = await apiFetch('/groups/me/current') as GroupSnapshot | null;
    applyGroupSnapshot(snapshot);
    return snapshot;
}
