import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, Keyboard, Platform, PermissionsAndroid, StyleSheet, Modal, Animated, PanResponder, Alert } from "react-native";
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from "react-native-maps";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Search, MapPin, Navigation, Users, LocateFixed, Map, XCircle, Mic } from "lucide-react-native";
import Geolocation from "react-native-geolocation-service";
import Tts from 'react-native-tts';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';
import Toast from 'react-native-toast-message';

import { AddEventButton } from "../components/AddEventButton";
import { AddEventModal } from "../components/AddEventModal";
import { IconButton } from "../components/IconButton";
import { SpeedBox } from "../components/SpeedBox";
import { TopBar } from "../components/TopBar";
import { RideInviteSheet } from '../components/RideInviteSheet';
import { SearchBar } from '../components/SearchBar';
import { ErrorBoundary } from '../components/ErrorBoundary';

import { ApiError, apiFetch } from '../services/api';
import { API_BASE_URL } from '@env';

import { useLocation } from '../hooks/useLocation';
import { useRerouting } from '../hooks/useRerouting';
import { useReporting } from '../hooks/useReporting';
import { useNearbyEvents } from '../hooks/useNearbyEvents';
import { useNearbyFriends } from '../hooks/useNearbyFriends';
import { useRideInvite } from '../hooks/useRideInvite';
import { useWebSocket } from '../hooks/useWebSocket';
import { useLocationBroadcaster } from '../hooks/useLocationBroadcaster';
import { useDislikedAreas } from '../hooks/useDislikedAreas';
import { useTelemetry } from '../hooks/useTelemetry';
import { useActiveRouteSync } from '../hooks/useActiveRouteSync';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useGroupVoice } from '../hooks/useGroupVoice';
import { useAvoidanceRoute } from '../hooks/useAvoidanceRoute';
import { useGroupStopProgress } from '../hooks/useGroupStopProgress';
import { maneuverSymbol, useTurnByTurn } from '../hooks/useTurnByTurn';
import { useDrivingFocusMode } from '../hooks/useDrivingFocusMode';

import { useSettingsStore } from '../store/useSettingsStore';
import { applyGroupSnapshot, GroupSnapshot } from '../services/groupSession';

const FOLLOW_CAMERA_ZOOM = 17.2;
const IDLE_CAMERA_ZOOM = 17.8;

const globalNotifiedFriends = new Set<string>();

interface InviteData {
  inviteId?: string;
  senderId?: string;
  friendName?: string;
  senderName?: string;
  distance: string;
  eta: string;
  groupId?: string;
  othersCount?: number;
  message?: string;
  isLocalInvite?: boolean;
  friendId?: string;
}

class ZenRouteError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ZenRouteError';
  }
}

function distanceBetweenMeters(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) {
  const earthRadius = 6371000;
  const latitudeDelta = (second.latitude - first.latitude) * Math.PI / 180;
  const longitudeDelta = (second.longitude - first.longitude) * Math.PI / 180;
  const firstLatitude = first.latitude * Math.PI / 180;
  const secondLatitude = second.latitude * Math.PI / 180;
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export default function MainScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const { speed, heading, coords } = useLocation();
  const speedMs = speed / 3.6;
  useKeepAwake();

  const activeCoords = coords;

  const [destination, setDestination] = useState<{ latitude: number, longitude: number } | null>(null);
  const [stopDestination, setStopDestination] = useState<{ latitude: number, longitude: number } | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<{ latitude: number, longitude: number }[]>([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distance: number, duration: number } | null>(null);

  const [isSearching, setIsSearching] = useState(false);
  const [, setSearchSessionId] = useState(0);
  const [pendingSearch, setPendingSearch] = useState<{ coords: { latitude: number, longitude: number }, name: string } | null>(null);
  const [isSafetyLockVisible, setIsSafetyLockVisible] = useState(false);

  const [isZenSession, setIsZenSession] = useState(false);
  const [zenDestination, setZenDestination] = useState<{ latitude: number, longitude: number } | null>(null);
  const [zenRouteOrigin, setZenRouteOrigin] = useState<{ latitude: number, longitude: number } | null>(null);
  const lastSyncedZenDestination = useRef<string | null>(null);

  const autoStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActiveGroupId = useRef<string | null>(null);
  const lastStartedGroupDestination = useRef<string | null>(null);
  const lastActiveLegKey = useRef<string | null>(null);

  const [showRideInvite, setShowRideInvite] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [isUpdatingGroupRoute, setIsUpdatingGroupRoute] = useState(false);
  const [isCancellingStop, setIsCancellingStop] = useState(false);

  const {
    isDNDActive,
    userId,
    userName,
    activeGroupId,
    groupOwnerId,
    groupDestination,
    rendezvousPoint,
    groupStops,
    setActiveGroupId,
    token,
    setGroupDestination,
    setGroupVersion,
    addGroupStop,
    removeGroupStop,
    removePendingGroupInvite,
  } = useSettingsStore();
  const isCurrentUserGroupOwner = Boolean(activeGroupId && userId && groupOwnerId === userId);
  const { submitReport, isSubmitting } = useReporting();
  const { events, refetchEvents } = useNearbyEvents(activeCoords.latitude || 44.4268, activeCoords.longitude || 26.1025);
  const { friends } = useNearbyFriends(activeCoords.latitude, activeCoords.longitude, token, activeGroupId);
  const { sendInvite } = useRideInvite();
  const {
    isConnected: isGroupVoiceConnected,
    isTransmitting: isGroupVoiceTransmitting,
    toggleTransmission,
  } = useGroupVoice(activeGroupId);

  const { dislikedAreas, addDislike } = useDislikedAreas();

  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ latitude: number, longitude: number } | null>(null);

  const {
    routeOrigin,
    initRouteOrigin,
    finishRerouting,
    resetRouteOrigin
  } = useRerouting(activeCoords, routeCoordinates, isNavigating, 50);

  const [isModalVisible, setModalVisible] = useState(false);
  const [region, setRegion] = useState({
    latitude: 44.4268,
    longitude: 26.1025,
    latitudeDelta: 0.002,
    longitudeDelta: 0.002,
  });
  const isDrivingFocusPaused = isSearching
    || Boolean(pendingSearch)
    || isSafetyLockVisible
    || isModalVisible
    || isReportModalVisible
    || showRideInvite;
  const {
    isFocusModeActive: isDrivingFocusMode,
    registerInteraction,
  } = useDrivingFocusMode({ paused: isDrivingFocusPaused });

  const currentDestination = groupDestination || destination;
  const isRendezvousLeg = Boolean(rendezvousPoint && groupDestination);
  const activeGroupStop = isRendezvousLeg ? null : groupStops[0] || null;
  const activeLocalStop = !activeGroupId && !isRendezvousLeg ? stopDestination : null;
  const activeLegDestination = rendezvousPoint && groupDestination
    ? rendezvousPoint
    : activeGroupStop || activeLocalStop || currentDestination;
  const activeStop = activeGroupStop || activeLocalStop;
  const activeLegLabel = isRendezvousLeg
    ? 'the meeting point'
    : activeGroupStop?.name || (activeLocalStop ? 'the stop' : groupDestination?.name || 'your destination');
  const activeLegKey = activeLegDestination
    ? `${activeLegDestination.latitude.toFixed(6)}:${activeLegDestination.longitude.toFixed(6)}`
    : null;

  const avoidanceRevision = dislikedAreas
    .map(area => `${area.id}:${area.latitude.toFixed(6)}:${area.longitude.toFixed(6)}`)
    .sort()
    .join('|');
  const normalPlannedRoute = useAvoidanceRoute({
    enabled: Boolean(activeLegDestination && routeOrigin && !isZenSession),
    origin: routeOrigin,
    destination: activeLegDestination,
    avoidanceRevision,
  });
  const zenPlannedRoute = useAvoidanceRoute({
    enabled: Boolean(isZenSession && zenDestination && zenRouteOrigin),
    origin: zenRouteOrigin,
    destination: zenDestination,
    avoidanceRevision,
  });
  const turnInstruction = useTurnByTurn(
    normalPlannedRoute.route?.steps || [],
    activeCoords,
    Boolean(isNavigating && !isZenSession),
    activeLegLabel,
  );

  const panY = useRef(new Animated.Value(0)).current;
  const cancelThreshold = -120;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy < 0) {
          panY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < cancelThreshold) {
          cancelNavigation();
          Animated.timing(panY, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        } else {
          Animated.spring(panY, { toValue: 0, useNativeDriver: true }).start();
        }
      }
    })
  ).current;

  const cancelOpacity = panY.interpolate({
    inputRange: [cancelThreshold, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp'
  });

  const handleIncomingInvite = (data: any) => {
    if (isDNDActive) {
      return;
    }
    const othersCount = data.othersCount || 0;

    const name = data.senderName || data.friendName || 'a friend';

    const inviteText = othersCount > 0
      ? `Join ${name} and ${othersCount} other riders?`
      : `Join ${name} for a ride?`;

    setInviteData({ ...data, message: inviteText });
    setShowRideInvite(true);
  };

  useWebSocket(token, activeGroupId, handleIncomingInvite);

  const handleGroupVoicePress = async () => {
    const result = await toggleTransmission();
    if (result === 'permission_denied') {
      Alert.alert(
        'Microphone permission required',
        'Allow microphone access to send live voice messages to your group.',
      );
      return;
    }
    if (result === 'not_ready') {
      Toast.show({
        type: 'info',
        text1: 'Group voice is connecting',
        text2: 'Please try again in a few seconds.',
      });
      return;
    }
    if (result === 'failed') {
      Toast.show({
        type: 'error',
        text1: 'Voice message failed',
        text2: 'Check your connection and try again.',
      });
    }
  };

  useLocationBroadcaster(
    userId,
    token,
    activeCoords.latitude,
    activeCoords.longitude,
    heading,
    speedMs,
    isDNDActive
  );

  useTelemetry(activeCoords.latitude, activeCoords.longitude, speedMs);
  useActiveRouteSync(routeCoordinates, isNavigating);
  useGroupStopProgress(activeGroupId, groupStops, activeCoords.latitude);
  usePushNotifications();

  useEffect(() => {
    const previousLegKey = lastActiveLegKey.current;
    lastActiveLegKey.current = activeLegKey;
    if (
      !previousLegKey
      || !activeLegKey
      || previousLegKey === activeLegKey
      || !isNavigating
      || activeCoords.latitude === 0
    ) {
      return;
    }
    setRouteCoordinates([]);
    setRouteInfo(null);
    initRouteOrigin(activeCoords);
  }, [activeCoords, activeLegKey, initRouteOrigin, isNavigating]);

  useEffect(() => {
    if (
      !stopDestination
      || activeGroupId
      || !isNavigating
      || activeCoords.latitude === 0
      || distanceBetweenMeters(activeCoords, stopDestination) > 100
    ) {
      return;
    }
    setStopDestination(null);
    Toast.show({
      type: 'success',
      text1: 'Stop reached',
      text2: 'Continuing to your final destination.',
    });
  }, [activeCoords, activeGroupId, isNavigating, stopDestination]);

  useEffect(() => {
    const previousGroupId = lastActiveGroupId.current;
    const groupChanged = previousGroupId !== activeGroupId;
    lastActiveGroupId.current = activeGroupId;

    if (groupChanged) {
      if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
      setDestination(null);
      setStopDestination(null);
      setRouteCoordinates([]);
      setRouteInfo(null);
      setIsNavigating(false);
      resetRouteOrigin();
      lastStartedGroupDestination.current = null;

      if (isZenSession) {
        setIsZenSession(false);
        setZenDestination(null);
        setZenRouteOrigin(null);
        lastSyncedZenDestination.current = null;
        fetch(`${API_BASE_URL}/routes/zen/stop`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        }).catch(() => { });
      }
    }

    if (!activeGroupId || !groupDestination || activeCoords.latitude === 0) {
      return;
    }

    const destinationKey = [
      activeGroupId,
      groupDestination.latitude.toFixed(6),
      groupDestination.longitude.toFixed(6),
    ].join(':');
    if (lastStartedGroupDestination.current === destinationKey) {
      return;
    }
    lastStartedGroupDestination.current = destinationKey;

    if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
    setIsNavigating(false);
    setRouteCoordinates([]);
    initRouteOrigin(activeCoords);
    setIsSearching(false);
    autoStartTimer.current = setTimeout(() => setIsNavigating(true), 5000);
  }, [
    activeCoords,
    activeGroupId,
    groupDestination,
    initRouteOrigin,
    isZenSession,
    resetRouteOrigin,
    token,
  ]);

  useEffect(() => {
    if (!normalPlannedRoute.route) return;

    setRouteCoordinates(normalPlannedRoute.route.coordinates);
    setRouteInfo({
      distance: normalPlannedRoute.route.distance,
      duration: normalPlannedRoute.route.duration,
    });
    finishRerouting();
  }, [normalPlannedRoute.route, finishRerouting]);

  useEffect(() => {
    if (normalPlannedRoute.isLoading) {
      setRouteCoordinates([]);
    }
  }, [normalPlannedRoute.isLoading]);

  useEffect(() => {
    if (!zenPlannedRoute.route) return;

    setRouteInfo({
      distance: zenPlannedRoute.route.distance,
      duration: zenPlannedRoute.route.duration,
    });
  }, [zenPlannedRoute.route]);

  useEffect(() => {
    const routeError = normalPlannedRoute.error || zenPlannedRoute.error;
    if (!routeError) return;

    const noAvoidingRoute = routeError instanceof ApiError
      && routeError.code === 'no_route_around_dislikes';
    Toast.show({
      type: 'error',
      text1: noAvoidingRoute ? 'Blocked street cannot be avoided' : 'Route unavailable',
      text2: noAvoidingRoute
        ? 'Remove the blocked area or choose another destination.'
        : 'Please try again in a moment.',
    });
  }, [normalPlannedRoute.error, zenPlannedRoute.error]);

  const handleAcceptRide = async () => {
    if (inviteData?.isLocalInvite) {
      if (!userName || !userId || !inviteData.friendId) {
        setShowRideInvite(false);
        return;
      }
      try {
        const result = await sendInvite(inviteData.friendId, userName, activeCoords.latitude, activeCoords.longitude);
        if (result.success && result.groupId) {
          Toast.show({ type: 'info', text1: 'Invite sent', text2: 'The Group Ride starts after acceptance.' });
        }
      } catch (err) {
        console.error("Failed to invite local friend:", err);
      }
      setShowRideInvite(false);
      return;
    }

    if (!inviteData?.groupId) {
      setShowRideInvite(false);
      return;
    }

    try {
      const groupData = await apiFetch(`/groups/${inviteData.groupId}/join`, { method: 'POST' }) as GroupSnapshot;

      if (groupData?.ownerId && groupData?.status) {
        applyGroupSnapshot(groupData);
      } else {
        setActiveGroupId(inviteData.groupId);
      }
      removePendingGroupInvite(inviteData.inviteId || inviteData.groupId);
      setShowRideInvite(false);

      if (!groupData?.destination) {
        Toast.show({
          type: 'info',
          text1: 'Group Ride started',
          text2: 'Waiting for the group owner to choose the destination.',
        });
      }

    } catch (error) {
      console.error("Failed to join ride:", error);
      setShowRideInvite(false);
    }
  };

  const handleDeclineRide = () => {
    setShowRideInvite(false);
    setInviteData(null);
  };

  const handleFriendClick = async (friendId: string, _friendName: string) => {
    if (isDNDActive || !userId || !userName) {
      return;
    }
    const result = await sendInvite(friendId, userName, activeCoords.latitude, activeCoords.longitude);
    if (result.success) {
      Toast.show({ type: 'info', text1: 'Invite sent', text2: 'Waiting for your friend to accept.' });
    }
  };

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') return true;
    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    requestLocationPermission().then((granted) => {
      if (!granted) return;
      Geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newRegion = { latitude, longitude, latitudeDelta: 0.002, longitudeDelta: 0.002 };
          setRegion(newRegion);

          if (!isSearching && mapRef.current) {
            mapRef.current.animateToRegion(newRegion, 1000);
          }
        },
        () => { },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });
  }, []);

  useEffect(() => {
    if (isDNDActive || isNavigating || isZenSession || activeGroupId) return;
    if (activeCoords.latitude === 0 || !friends || friends.length === 0) return;

    friends.forEach(friend => {
      if (globalNotifiedFriends.has(friend.id)) return;

      const R = 6371;
      const dLat = (friend.latitude - activeCoords.latitude) * Math.PI / 180;
      const dLon = (friend.longitude - activeCoords.longitude) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(activeCoords.latitude * Math.PI / 180) * Math.cos(friend.latitude * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceCode = R * c;

      if (distanceCode < 2.0 && !showRideInvite) {
        setInviteData({
          isLocalInvite: true,
          friendId: friend.id,
          friendName: friend.name,
          distance: distanceCode < 1 ? `${Math.round(distanceCode * 1000)} m` : `${distanceCode.toFixed(1)} km`,
          eta: `${Math.round(distanceCode * 2)} min`
        });
        setShowRideInvite(true);
        globalNotifiedFriends.add(friend.id);
      }
    });
  }, [friends, activeCoords, isDNDActive, isNavigating, isZenSession, activeGroupId, showRideInvite]);

  useEffect(() => {
    return () => {
      if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
    };
  }, []);

  useEffect(() => {
    if (activeCoords.latitude !== 0 && !isSearching && mapRef.current) {
      if (currentDestination && !isNavigating && !isZenSession) return;

      const isDriving = speed > 5;

      mapRef.current.animateCamera({
        center: activeCoords,
        heading: isDriving ? heading : 0,
        pitch: 0,
        zoom: isDriving || isNavigating || isZenSession ? FOLLOW_CAMERA_ZOOM : IDLE_CAMERA_ZOOM,
      }, { duration: 1000 });
    }
  }, [activeCoords, heading, speed, isSearching, currentDestination, isNavigating, isZenSession]);

  const closeSearch = () => {
    setIsSearching(false);
    Keyboard.dismiss();
  };

  const cancelNavigation = () => {
    setDestination(null);
    setStopDestination(null);
    resetRouteOrigin();
    setRouteCoordinates([]);
    setZenDestination(null);
    setZenRouteOrigin(null);
    setIsNavigating(false);
    setIsSearching(false);
    setSearchSessionId(prev => prev + 1);
    setRouteInfo(null);
    panY.setValue(0);

    if (isZenSession) {
      setIsZenSession(false);
      lastSyncedZenDestination.current = null;
      fetch(`${API_BASE_URL}/routes/zen/stop`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }).catch(() => { });
    }
    if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
  };

  const handleOpenSearch = () => {
    if (speed > 10) {
      setIsSafetyLockVisible(true);
      return;
    }
    openSearchForce();
  };

  const openSearchForce = () => {
    if (isZenSession) {
      cancelNavigation();
    }
    setIsSafetyLockVisible(false);
    setSearchSessionId(prev => prev + 1);
    setIsSearching(true);
  };

  const sendGroupStop = async (groupId: string, stopCoords: { latitude: number, longitude: number }, name: string) => {
    try {
      const update = await apiFetch(`/groups/${groupId}/stop`, {
        method: 'POST',
        body: JSON.stringify({
          latitude: stopCoords.latitude,
          longitude: stopCoords.longitude,
          name: name
        })
      });
      if (update?.appliesToCurrentUser && update?.stop?.id) {
        addGroupStop(update.stop);
      }
      if (typeof update?.version === 'number') {
        setGroupVersion(update.version);
      }
      if (update?.appliesToCurrentUser === false) {
        Toast.show({
          type: 'info',
          text1: 'Stop shared with the group',
          text2: 'It is already behind you, so your route stays unchanged.',
        });
      }
      return true;
    } catch (error) {
      console.error("Error sharing group stop:", error);
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert('Could not add group stop', message);
      return false;
    }
  };

  const cancelCurrentStop = async () => {
    if (!activeStop || isCancellingStop) return;
    if (!activeGroupStop || !activeGroupId) {
      setStopDestination(null);
      Toast.show({
        type: 'info',
        text1: 'Stop cancelled',
        text2: 'Continuing to your final destination.',
      });
      return;
    }

    const executeCancellation = async () => {
      setIsCancellingStop(true);
      try {
        const cancellation = await apiFetch(
          `/groups/${activeGroupId}/stops/${activeGroupStop.id}`,
          { method: 'DELETE' },
        );
        removeGroupStop(activeGroupStop.id);
        if (typeof cancellation?.version === 'number') {
          setGroupVersion(cancellation.version);
        }
        Toast.show({
          type: 'info',
          text1: cancellation?.cancelledForAll ? 'Group stop cancelled' : 'Stop skipped',
          text2: cancellation?.cancelledForAll
            ? 'The stop was removed for every group member.'
            : 'The other group members will still visit this stop.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Please try again.';
        Alert.alert('Could not cancel stop', message);
      } finally {
        setIsCancellingStop(false);
      }
    };

    if (isCurrentUserGroupOwner) {
      Alert.alert(
        'Cancel for the entire group?',
        'This stop will be removed from every member’s route.',
        [
          { text: 'Keep Stop', style: 'cancel' },
          { text: 'Cancel for Everyone', style: 'destructive', onPress: executeCancellation },
        ],
      );
      return;
    }
    await executeCancellation();
  };

  const handlePlaceSelect = (destCoords: { latitude: number, longitude: number }, name: string) => {
    if (activeGroupId || destination) {
      setPendingSearch({ coords: destCoords, name });
      setIsSearching(false);
    } else {
      setDestination(destCoords);
      startNavigationProtocol();
    }
  };

  const handleSetNewDestination = async () => {
    if (!pendingSearch) return;

    if (activeGroupId) {
      if (!isCurrentUserGroupOwner || isUpdatingGroupRoute) {
        Alert.alert('Owner action required', 'Only the group owner can change the final destination.');
        return;
      }

      setIsUpdatingGroupRoute(true);
      try {
        const update = await apiFetch(`/groups/${activeGroupId}/destination`, {
          method: 'PUT',
          body: JSON.stringify({
            latitude: pendingSearch.coords.latitude,
            longitude: pendingSearch.coords.longitude,
            name: pendingSearch.name,
          }),
        });
        setGroupDestination(update.destination);
        setGroupVersion(update.version);
        setPendingSearch(null);
        Toast.show({
          type: 'success',
          text1: 'Group destination updated',
          text2: update.destination?.name || pendingSearch.name,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Please try again.';
        Alert.alert('Could not update group destination', message);
      } finally {
        setIsUpdatingGroupRoute(false);
      }
      return;
    }

    setStopDestination(null);
    setDestination(pendingSearch.coords);
    setPendingSearch(null);
    startNavigationProtocol();
  };

  const handleAddStop = async () => {
    if (!pendingSearch) return;

    if (activeGroupId) {
      if (isUpdatingGroupRoute) return;
      setIsUpdatingGroupRoute(true);
      const succeeded = await sendGroupStop(activeGroupId, pendingSearch.coords, pendingSearch.name);
      setIsUpdatingGroupRoute(false);
      if (!succeeded) return;
    } else {
      setStopDestination(pendingSearch.coords);
    }
    setPendingSearch(null);
    if (currentDestination) {
      startNavigationProtocol();
    }
  };

  const startNavigationProtocol = () => {
    if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
    setIsNavigating(false);
    setRouteCoordinates([]);
    initRouteOrigin(activeCoords);
    setIsSearching(false);

    autoStartTimer.current = setTimeout(() => {
      setIsNavigating(true);
    }, 5000);
  };

  const recenterMap = () => {
    if (activeCoords.latitude !== 0 && mapRef.current) {
      mapRef.current.animateCamera({
        center: activeCoords,
        heading: speed > 5 ? heading : 0,
        pitch: 0,
        zoom: isNavigating || isZenSession ? FOLLOW_CAMERA_ZOOM : IDLE_CAMERA_ZOOM,
      }, { duration: 1000 });
    }
  };

  const handleMapLongPress = (event: any) => {
    registerInteraction();
    const { coordinate } = event.nativeEvent;
    setSelectedLocation(coordinate);
    setIsReportModalVisible(true);
  };

  const handleSendReport = async (type: 'police' | 'pothole' | 'accident') => {
    if (!selectedLocation) return;
    const result = await submitReport(type, selectedLocation.latitude, selectedLocation.longitude);
    if (result.success) {
      setIsReportModalVisible(false);
      refetchEvents();
    }
  };

  const handleDislikeArea = async () => {
    if (!selectedLocation) return;
    const success = await addDislike(
      selectedLocation.latitude,
      selectedLocation.longitude,
      "User Manual Block",
      'area',
    );
    if (success) {
      setIsReportModalVisible(false);
    }
    Toast.show({
      type: success ? 'success' : 'error',
      text1: success ? 'Area blocked' : 'Could not block area',
      text2: success
        ? 'Normal and Zen routes will avoid it.'
        : 'The area may already be blocked. Please try again.',
    });
  };

  const toggleZenSession = async () => {
    if (activeGroupId) {
      Toast.show({
        type: 'info',
        text1: 'Group navigation is active',
        text2: 'The group owner chooses the shared final destination.',
      });
      return;
    }
    const newZenState = !isZenSession;
    setIsZenSession(newZenState);

    if (newZenState) {
      setZenDestination(null);
      setZenRouteOrigin(null);
      lastSyncedZenDestination.current = null;
      try {
        const response = await fetch(`${API_BASE_URL}/routes/zen/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            latitude: activeCoords.latitude,
            longitude: activeCoords.longitude,
            heading: heading ?? 0
          })
        });

        const text = await response.text();
        if (!response.ok) {
          let code = 'safe_route_unavailable';
          let message = `ZenSession API Error ${response.status}`;
          try {
            const errorPayload = JSON.parse(text);
            code = errorPayload.error || code;
            message = errorPayload.message || message;
          } catch {
            // Preserve the fallback error when an upstream proxy returns HTML.
          }
          throw new ZenRouteError(code, message);
        }
        const data = JSON.parse(text);
        if (data.next_lat && data.next_lng) {
          setZenRouteOrigin(activeCoords);
          setZenDestination({ latitude: data.next_lat, longitude: data.next_lng });
          setIsNavigating(true);
        }
      } catch (error) {
        console.error("ZenSession failed to start:", error);
        setIsZenSession(false);

        const isRoadDataUnavailable = error instanceof ZenRouteError
          && error.code === 'road_data_unavailable';
        const isMissingCorridor = error instanceof ZenRouteError
          && error.code === 'no_connected_corridor';
        Toast.show({
          type: 'error',
          text1: isRoadDataUnavailable
            ? 'Road data temporarily unavailable'
            : isMissingCorridor
              ? 'No connected road corridor nearby'
              : 'Zen route unavailable',
          text2: isRoadDataUnavailable
            ? 'Please try Zen again in a moment.'
            : isMissingCorridor
              ? 'Move closer to a public road and try again.'
              : 'Please try again.',
        });
      }
    } else {
      cancelNavigation();
    }
  };

  useEffect(() => {
    if (!isZenSession || !zenDestination || !token || activeCoords.latitude === 0) return;

    const destinationKey = `${zenDestination.latitude.toFixed(6)}:${zenDestination.longitude.toFixed(6)}`;

    const distM = (() => {
      const R = 6371000;
      const rad = Math.PI / 180;
      const dLat = (zenDestination.latitude - activeCoords.latitude) * rad;
      const dLng = (zenDestination.longitude - activeCoords.longitude) * rad;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(activeCoords.latitude * rad) * Math.cos(zenDestination.latitude * rad) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    })();

    if (distM < 500 && lastSyncedZenDestination.current !== destinationKey) {
      lastSyncedZenDestination.current = destinationKey;
      fetch(`${API_BASE_URL}/routes/zen/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          latitude: activeCoords.latitude,
          longitude: activeCoords.longitude,
          heading: heading ?? 0,
          expected_waypoint_lat: zenDestination.latitude,
          expected_waypoint_lng: zenDestination.longitude,
        })
      })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Zen sync failed with status ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          if ((data.status === 'extended' || data.status === 'stale') && data.next_lat && data.next_lng) {
            setZenRouteOrigin(activeCoords);
            setZenDestination({ latitude: data.next_lat, longitude: data.next_lng });
          }
        })
        .catch(error => {
          lastSyncedZenDestination.current = null;
          console.warn('Zen waypoint sync failed:', error);
        });
    }
  }, [activeCoords, heading, isZenSession, zenDestination, token]);


  const formatDistance = (dist: number) => dist < 1 ? `${(dist * 1000).toFixed(0)} m` : `${dist.toFixed(1)} km`;
  const formatTurnDistance = (distanceMeters: number) => distanceMeters < 1000
    ? `${Math.max(10, Math.round(distanceMeters / 10) * 10)} m`
    : `${(distanceMeters / 1000).toFixed(distanceMeters < 10000 ? 1 : 0)} km`;
  const formatDuration = (mins: number) => {
    if (mins < 60) return `${Math.ceil(mins)} min`;
    const hours = Math.floor(mins / 60);
    const m = Math.ceil(mins % 60);
    return `${hours} h ${m} m`;
  };

  return (
    <View style={styles.container} onTouchStart={registerInteraction}>
      {!isDrivingFocusMode && (
        <SafeAreaView style={styles.topSection} edges={["top"]}>
          <TopBar onZenPress={toggleZenSession} isZenActive={isZenSession} />
        </SafeAreaView>
      )}

      <View style={styles.mapContainer}>
        <ErrorBoundary>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            customMapStyle={nightMapStyle}
            initialRegion={region}
            showsUserLocation={false}
            showsMyLocationButton={false}
            showsCompass={false}
            pitchEnabled={false}
            rotateEnabled={false}
            loadingEnabled={true}
            mapPadding={{ top: 0, right: 0, bottom: isDrivingFocusMode ? 16 : 120, left: 0 }}
            onPress={registerInteraction}
            onPanDrag={registerInteraction}
            onLongPress={handleMapLongPress}
          >
            {activeCoords.latitude !== 0 && (
              <Marker
                coordinate={activeCoords}
                anchor={{ x: 0.5, y: 0.5 }}
                flat={true}
                rotation={heading}
              >
                <View style={[styles.customMarkerGlow]}>
                  <Navigation
                    color={isZenSession ? "#10B981" : "#8A2BE2"}
                    size={45}
                    fill={isZenSession ? "#10B981" : "#8A2BE2"}
                  />
                </View>
              </Marker>
            )}

            {friends.map((friend) => (
              <Marker
                key={friend.id}
                coordinate={{ latitude: friend.latitude, longitude: friend.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                flat={true}
                rotation={friend.heading}
                tracksViewChanges={false}
                onPress={() => handleFriendClick(friend.id, friend.name)}
              >
                <View style={styles.friendMarkerContainer}>
                  <Navigation color="#10B981" size={30} fill="#10B981" />
                  <Text style={styles.friendMarkerText}>{friend.name}</Text>
                </View>
              </Marker>
            ))}

            {events?.map((event) => (
              <Marker
                key={event.id}
                coordinate={{ latitude: event.latitude, longitude: event.longitude }}
                tracksViewChanges={false}
              >
                <View style={styles.eventMarkerContainer}>
                  <Text style={styles.eventMarkerEmoji}>
                    {event.type === 'police' ? '🚔' : event.type === 'pothole' ? '⚠️' : '💥'}
                  </Text>
                </View>
              </Marker>
            ))}

            {rendezvousPoint && (
              <Marker coordinate={rendezvousPoint} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.rendezvousMarker}>
                  <Users color="#FFF" size={24} />
                </View>
              </Marker>
            )}

            {groupDestination && (
              <Marker coordinate={groupDestination} anchor={{ x: 0.5, y: 1 }}>
                <View style={styles.groupDestinationMarker}>
                  <MapPin color="#FFF" size={28} />
                </View>
              </Marker>
            )}

            {destination && !groupDestination && (
              <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }}>
                <View style={styles.groupDestinationMarker}>
                  <MapPin color="#FFF" size={28} />
                </View>
              </Marker>
            )}

            {groupStops.map((stop) => (
              <Marker key={stop.id} coordinate={stop} anchor={{ x: 0.5, y: 1 }}>
                <View style={styles.stopDestinationMarker}>
                  <MapPin color="#FFF" size={20} />
                </View>
              </Marker>
            ))}

            {activeLegDestination && routeOrigin && !isZenSession && normalPlannedRoute.route && (
              <Polyline
                coordinates={normalPlannedRoute.route.coordinates}
                strokeWidth={8}
                strokeColor="#8A2BE2"
              />
            )}

            {stopDestination && (
              <Marker coordinate={stopDestination} anchor={{ x: 0.5, y: 1 }}>
                <View style={styles.stopDestinationMarker}>
                  <MapPin color="#FFF" size={20} />
                </View>
              </Marker>
            )}

            {isZenSession && zenDestination && zenPlannedRoute.route && (
              <Polyline
                coordinates={zenPlannedRoute.route.coordinates}
                strokeWidth={8}
                strokeColor="#10B981"
              />
            )}
          </MapView>
        </ErrorBoundary>
      </View>

      {turnInstruction && (
        <View style={[
          styles.turnInstructionCard,
          { top: insets.top + (isDrivingFocusMode ? 12 : 68) },
        ]}>
          <Text style={styles.turnInstructionSymbol}>{maneuverSymbol(turnInstruction.maneuver)}</Text>
          <View style={styles.turnInstructionContent}>
            <Text style={styles.turnInstructionDistance}>
              {formatTurnDistance(turnInstruction.distanceMeters)}
            </Text>
            <Text style={styles.turnInstructionText} numberOfLines={2}>
              {turnInstruction.instruction}
            </Text>
          </View>
        </View>
      )}

      <Modal visible={isSearching} animationType="fade" transparent={true}>
        <View style={[styles.searchContainer, { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }]}>
          <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
            <SearchBar
              placeholder="Where to?"
              onClose={closeSearch}
              onPlaceSelect={handlePlaceSelect}
              userCoords={activeCoords}
            />
          </SafeAreaView>
        </View>
      </Modal>

      {activeGroupId && !isSearching && !isDrivingFocusMode && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={isGroupVoiceTransmitting ? 'Stop group voice message' : 'Start group voice message'}
          accessibilityHint="Tap once to start. It stops automatically after ten seconds, or tap again to stop early."
          accessibilityState={{
            busy: !isGroupVoiceConnected,
            selected: isGroupVoiceTransmitting,
          }}
          activeOpacity={0.8}
          touchSoundDisabled={false}
          onPress={handleGroupVoicePress}
          style={[
            styles.groupVoiceButton,
            !isGroupVoiceConnected && styles.groupVoiceButtonConnecting,
            isGroupVoiceTransmitting && styles.groupVoiceButtonTransmitting,
            { bottom: Math.max(insets.bottom, 20) + 112 },
          ]}
        >
          <Mic color="#FFF" size={29} strokeWidth={2.5} />
        </TouchableOpacity>
      )}

      {!isSearching && !isDrivingFocusMode && (
        <View style={styles.bottomWrapper}>
          {isNavigating && (
            <Animated.View style={[styles.cancelBackground, { opacity: cancelOpacity }]}>
              <XCircle color="white" size={32} />
              <Text style={styles.cancelText}>Release to cancel the route</Text>
            </Animated.View>
          )}

          <Animated.View
            style={
              [styles.bottomSection,
              {
                transform: [{ translateY: panY }],
                paddingBottom: Math.max(insets.bottom, 20)
              }]}
            {...(isNavigating ? panResponder.panHandlers : {})}
          >
            {isNavigating && <View style={styles.dragHandle} />}

            {isNavigating && !isZenSession && routeInfo && (
              <View style={styles.routeInfoBox}>
                <Text style={styles.routeInfoText}>{formatDuration(routeInfo.duration)}</Text>
                <Text style={styles.routeInfoDot}>•</Text>
                <Text style={styles.routeInfoText}>{formatDistance(routeInfo.distance)}</Text>
              </View>
            )}

            {isNavigating && !isZenSession && activeStop && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={isCurrentUserGroupOwner && activeGroupStop ? 'Cancel stop for the entire group' : 'Cancel current stop'}
                style={[styles.cancelStopButton, isCancellingStop && styles.cancelStopButtonDisabled]}
                onPress={cancelCurrentStop}
                disabled={isCancellingStop}
              >
                <XCircle color="#FCA5A5" size={18} />
                <Text style={styles.cancelStopButtonText}>
                  {isCurrentUserGroupOwner && activeGroupStop ? 'Cancel Stop for Group' : activeGroupStop ? 'Skip Stop' : 'Cancel Stop'}
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.contentContainer}>
              <View style={{ flexDirection: 'row', gap: 15 }}>
                <IconButton icon={<Search color="white" size={28} />} onPress={handleOpenSearch} />
                <IconButton icon={<LocateFixed color="#3B82F6" size={28} />} onPress={recenterMap} />
              </View>
              <View style={styles.centerButtonSpacer}>
                <AddEventButton onPress={() => setModalVisible(true)} />
              </View>
              <SpeedBox speed={speed} limit={80} />
            </View>
          </Animated.View>
        </View>
      )}

      {!isSearching && isDrivingFocusMode && (
        <View
          pointerEvents="none"
          style={[
            styles.drivingFocusSpeed,
            { bottom: Math.max(insets.bottom, 16) + 12 },
          ]}
        >
          <SpeedBox speed={speed} limit={80} />
        </View>
      )}

      <Modal visible={!!pendingSearch} transparent animationType="slide">
        <View style={styles.actionSheetOverlay}>
          <View style={styles.actionSheetContent}>
            <Text style={styles.actionSheetTitle}>
              {activeGroupId ? 'Update Group Route' : 'Active Route Existing'}
            </Text>
            <Text style={styles.actionSheetSubtitle}>What do you want to do with {pendingSearch?.name}?</Text>

            {(!activeGroupId || isCurrentUserGroupOwner) && (
              <TouchableOpacity
                style={[styles.actionBtnPrimary, isUpdatingGroupRoute && { opacity: 0.55 }]}
                onPress={handleSetNewDestination}
                disabled={isUpdatingGroupRoute}
              >
                <Map color="#FFF" size={24} />
                <Text style={styles.actionBtnTextPrimary}>
                  {activeGroupId ? 'Set Final Group Destination' : 'New Destination (Replace)'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionBtnSecondary, isUpdatingGroupRoute && { opacity: 0.55 }]}
              onPress={handleAddStop}
              disabled={isUpdatingGroupRoute}
            >
              <MapPin color="#A855F7" size={24} />
              <Text style={styles.actionBtnTextSecondary}>
                {activeGroupId ? 'Add Group Stop' : 'Add as Stop'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setPendingSearch(null)}>
              <Text style={styles.actionBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isSafetyLockVisible} transparent animationType="slide">
        <View style={styles.actionSheetOverlay}>
          <View style={styles.actionSheetContent}>
            <Text style={styles.actionSheetTitle}>Safety Lock</Text>
            <Text style={styles.actionSheetSubtitle}>It is not safe to use the keyboard while you are driving.</Text>

            <TouchableOpacity style={styles.actionBtnPrimary} onPress={() => {
              setIsSafetyLockVisible(false);
              Tts.speak('Where do you want to go?');
            }}>
              <Mic color="#FFF" size={24} />
              <Text style={styles.actionBtnTextPrimary}>Voice Command</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtnSecondary} onPress={openSearchForce}>
              <Text style={styles.actionBtnTextSecondary}>I am not driving</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setIsSafetyLockVisible(false)}>
              <Text style={styles.actionBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AddEventModal isVisible={isModalVisible} onClose={() => setModalVisible(false)} />

      <Modal
        visible={isReportModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsReportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.reportContent}>
            <Text style={styles.reportTitle}>REPORT EVENT</Text>

            <View style={styles.reportButtonsContainer}>
              <TouchableOpacity
                style={[styles.reportBtn, { borderColor: '#3B82F6' }]}
                onPress={() => handleSendReport('police')}
                disabled={isSubmitting}
              >
                <Text style={{ fontSize: 30 }}>🚔</Text>
                <Text style={styles.reportBtnText}>POLICE</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.reportBtn, { borderColor: '#F59E0B' }]}
                onPress={() => handleSendReport('pothole')}
                disabled={isSubmitting}
              >
                <Text style={{ fontSize: 30 }}>⚠️</Text>
                <Text style={styles.reportBtnText}>POTHOLE</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.reportBtn, { borderColor: '#EF4444' }]}
                onPress={() => handleSendReport('accident')}
                disabled={isSubmitting}
              >
                <Text style={{ fontSize: 30 }}>💥</Text>
                <Text style={styles.reportBtnText}>ACCIDENT</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.reportBtn, { borderColor: '#6B7280' }]}
                onPress={handleDislikeArea}
                disabled={isSubmitting}
              >
                <Text style={{ fontSize: 30 }}>🚫</Text>
                <Text style={styles.reportBtnText}>BLOCK</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsReportModalVisible(false)}>
              <Text style={styles.cancelBtnText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <RideInviteSheet
        isVisible={showRideInvite}
        friendName={inviteData?.friendName || ""}
        distance={inviteData?.distance || ""}
        eta={inviteData?.eta || ""}
        onAccept={handleAcceptRide}
        onDecline={handleDeclineRide}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  topSection: { backgroundColor: "#000", zIndex: 10 },
  simulatingBadge: { position: 'absolute', bottom: -20, alignSelf: 'center', backgroundColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10 },
  simulatingText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  searchContainer: { flex: 1, backgroundColor: "#000" },
  iconPadding: { justifyContent: 'center', paddingHorizontal: 15 },
  bottomWrapper: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 5,
  },
  drivingFocusSpeed: {
    position: 'absolute',
    right: 18,
    zIndex: 8,
    elevation: 10,
  },
  groupVoiceButton: {
    position: 'absolute',
    left: 22,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8A2BE2',
    borderWidth: 2,
    borderColor: '#B76CFF',
    shadowColor: '#8A2BE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 8,
  },
  groupVoiceButtonConnecting: {
    backgroundColor: '#3F3F46',
    borderColor: '#71717A',
    shadowOpacity: 0.15,
  },
  groupVoiceButtonTransmitting: {
    backgroundColor: '#EF4444',
    borderColor: '#FCA5A5',
    shadowColor: '#EF4444',
    shadowOpacity: 0.65,
  },
  cancelBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    flexDirection: 'column',
    gap: 10,
    paddingBottom: 40
  },
  cancelText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1
  },
  bottomSection: {
    backgroundColor: "rgba(10, 10, 10, 0.95)",
    borderTopWidth: 1,
    borderTopColor: "#1A1A1A",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
  },
  contentContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 25,
    paddingTop: 10,
    paddingBottom: 25,
  },
  centerButtonSpacer: { flex: 1, alignItems: "center" },
  routeInfoBox: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginTop: 15,
    marginBottom: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeInfoText: {
    color: '#8A2BE2',
    fontSize: 15,
    fontWeight: '900',
  },
  routeInfoDot: {
    color: '#666',
    fontSize: 15,
    marginHorizontal: 10,
    fontWeight: '900',
  },
  cancelStopButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(127, 29, 29, 0.28)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.4)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  cancelStopButtonDisabled: {
    opacity: 0.5,
  },
  cancelStopButtonText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '800',
  },
  turnInstructionCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9,
    elevation: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12, 12, 14, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.55)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  turnInstructionSymbol: {
    color: '#C084FC',
    fontSize: 40,
    fontWeight: '800',
    width: 54,
    textAlign: 'center',
    marginRight: 12,
  },
  turnInstructionContent: {
    flex: 1,
  },
  turnInstructionDistance: {
    color: '#C084FC',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 2,
  },
  turnInstructionText: {
    color: '#F4F4F5',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },

  stopDestinationMarker: {
    backgroundColor: '#F59E0B',
    padding: 6,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },

  actionSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end'
  },
  actionSheetContent: {
    backgroundColor: '#111',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 25,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#333',
    alignItems: 'center'
  },
  actionSheetTitle: { color: 'white', fontSize: 18, fontWeight: '900', marginBottom: 5 },
  actionSheetSubtitle: { color: '#888', fontSize: 14, marginBottom: 25, textAlign: 'center' },
  actionBtnPrimary: {
    flexDirection: 'row',
    backgroundColor: '#8A2BE2',
    width: '100%',
    padding: 18,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
    gap: 10
  },
  actionBtnTextPrimary: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  actionBtnSecondary: {
    flexDirection: 'row',
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#8A2BE2',
    width: '100%',
    padding: 18,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10
  },
  actionBtnTextSecondary: { color: '#8A2BE2', fontSize: 16, fontWeight: 'bold' },
  actionBtnCancel: { padding: 15 },
  actionBtnTextCancel: { color: '#666', fontSize: 16, fontWeight: 'bold' },
  customMarkerGlow: {
    shadowColor: "#8A2BE2",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  },
  eventMarkerContainer: {
    backgroundColor: 'rgba(17, 17, 17, 0.9)',
    padding: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 5,
  },
  eventMarkerEmoji: {
    fontSize: 24,
  },
  friendMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  },
  friendMarkerText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 4,
    borderRadius: 4,
    marginTop: 2,
    position: 'absolute',
    bottom: -15,
  },
  rendezvousMarker: {
    backgroundColor: '#10B981',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  groupDestinationMarker: {
    backgroundColor: '#8A2BE2',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: '#8A2BE2',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  reportContent: {
    backgroundColor: '#111',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 25,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  reportTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 25,
  },
  reportButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 30,
  },
  reportBtn: {
    width: '22%',
    aspectRatio: 1,
    backgroundColor: '#050505',
    borderRadius: 20,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  reportBtnText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  cancelBtn: {
    paddingVertical: 15,
    width: '100%',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#666',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});

const nightMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#000000" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#8A2BE2" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#1a1a1a" }] },
  { featureType: "road.arterial", elementType: "geometry.fill", stylers: [{ color: "#222222" }] },
  { featureType: "road.local", elementType: "geometry.fill", stylers: [{ color: "#333333" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] }
];
