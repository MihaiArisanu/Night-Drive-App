import React, { createContext, useContext, useState } from "react";

interface GroupMember {
  id: string;
  name: string;
  tag: string;
}

interface GroupInvite {
  id: string;
  senderName: string;
  groupId: string;
}

interface LocationPoint {
  latitude: number;
  longitude: number;
  name?: string;
}

interface SettingsContextType {
  isDNDActive: boolean;
  setIsDNDActive: (value: boolean) => void;
  userId: string | null;
  setUserId: (value: string | null) => void;
  userName: string | null;
  setUserName: (value: string | null) => void;
  activeGroupId: string | null;
  setActiveGroupId: (value: string | null) => void;
  groupMembers: GroupMember[];
  setGroupMembers: (value: GroupMember[]) => void;
  pendingGroupInvites: GroupInvite[];
  setPendingGroupInvites: (value: GroupInvite[]) => void;
  groupDestination: LocationPoint | null;
  setGroupDestination: (value: LocationPoint | null) => void;
  rendezvousPoint: LocationPoint | null;
  setRendezvousPoint: (value: LocationPoint | null) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [isDNDActive, setIsDNDActive] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [pendingGroupInvites, setPendingGroupInvites] = useState<GroupInvite[]>([]);

  const [groupDestination, setGroupDestination] = useState<LocationPoint | null>(null);
  const [rendezvousPoint, setRendezvousPoint] = useState<LocationPoint | null>(null);

  return (
    <SettingsContext.Provider value={{
      isDNDActive, setIsDNDActive,
      userId, setUserId,
      userName, setUserName,
      activeGroupId, setActiveGroupId,
      groupMembers, setGroupMembers,
      pendingGroupInvites, setPendingGroupInvites,
      groupDestination, setGroupDestination,
      rendezvousPoint, setRendezvousPoint
    }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within a SettingsProvider");
  return context;
};