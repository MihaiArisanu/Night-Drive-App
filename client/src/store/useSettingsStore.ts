import { create } from 'zustand';

export interface GroupMember {
    id: string;
    name: string;
    tag: string;
    profile_picture_url?: string;
    isFriend?: boolean;
}

export interface GroupInvite {
    id: string;
    senderName: string;
    groupId: string;
    senderId?: string;
    createdAt?: string;
}

interface LocationPoint {
    latitude: number;
    longitude: number;
    name?: string;
}

interface SettingsState {
    isDNDActive: boolean;
    userId: string | null;
    userName: string | null;
    token: string | null;
    activeGroupId: string | null;
    draftGroupId: string | null;
    groupMembers: GroupMember[];
    pendingGroupInvites: GroupInvite[];
    groupDestination: LocationPoint | null;
    rendezvousPoint: LocationPoint | null;
    groupStop: LocationPoint | null;
    groupRoutePolyline: string | null;

    setIsDNDActive: (value: boolean) => void;
    setUserId: (value: string | null) => void;
    setUserName: (value: string | null) => void;
    setToken: (value: string | null) => void;
    setActiveGroupId: (value: string | null) => void;
    setDraftGroupId: (value: string | null) => void;
    setGroupMembers: (value: GroupMember[]) => void;
    setPendingGroupInvites: (value: GroupInvite[]) => void;
    addPendingGroupInvite: (value: GroupInvite) => void;
    removePendingGroupInvite: (inviteIdOrGroupId: string) => void;
    setGroupDestination: (value: LocationPoint | null) => void;
    setRendezvousPoint: (value: LocationPoint | null) => void;
    setGroupStop: (value: LocationPoint | null) => void;
    setGroupRoutePolyline: (polyline: string | null) => void;

    clearSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
    isDNDActive: false,
    userId: null,
    userName: null,
    token: null,
    activeGroupId: null,
    draftGroupId: null,
    groupMembers: [],
    pendingGroupInvites: [],
    groupDestination: null,
    rendezvousPoint: null,
    groupStop: null,
    groupRoutePolyline: null,

    setIsDNDActive: (value) => set({ isDNDActive: value }),
    setUserId: (value) => set({ userId: value }),
    setUserName: (value) => set({ userName: value }),
    setToken: (value) => set({ token: value }),
    setActiveGroupId: (value) => set({ activeGroupId: value }),
    setDraftGroupId: (value) => set({ draftGroupId: value }),
    setGroupMembers: (value) => set({ groupMembers: value }),
    setPendingGroupInvites: (value) => set({ pendingGroupInvites: value }),
    addPendingGroupInvite: (value) => set((state) => ({
        pendingGroupInvites: [
            value,
            ...state.pendingGroupInvites.filter(
                (invite) => invite.id !== value.id && invite.groupId !== value.groupId,
            ),
        ],
    })),
    removePendingGroupInvite: (inviteIdOrGroupId) => set((state) => ({
        pendingGroupInvites: state.pendingGroupInvites.filter(
            (invite) => invite.id !== inviteIdOrGroupId && invite.groupId !== inviteIdOrGroupId,
        ),
    })),
    setGroupDestination: (value) => set({ groupDestination: value }),
    setRendezvousPoint: (value) => set({ rendezvousPoint: value }),
    setGroupStop: (value) => set({ groupStop: value }),
    setGroupRoutePolyline: (value) => set({ groupRoutePolyline: value }),

    clearSettings: () => set({
        userId: null, userName: null, token: null, activeGroupId: null, draftGroupId: null,
        groupMembers: [], pendingGroupInvites: [], groupDestination: null, rendezvousPoint: null, groupStop: null, groupRoutePolyline: null
    }),
}));
