import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, Keyboard, Platform, PermissionsAndroid, StyleSheet, Modal, Animated, PanResponder } from "react-native";
import MapView, { PROVIDER_GOOGLE, Marker, Circle, Polyline } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, MapPin, Navigation, Users, LocateFixed, Map, XCircle } from "lucide-react-native";
import Geolocation from "react-native-geolocation-service";
import MapViewDirections from 'react-native-maps-directions';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';

import { AddEventButton } from "../components/AddEventButton";
import { AddEventModal } from "../components/AddEventModal";
import { IconButton } from "../components/IconButton";
import { SpeedBox } from "../components/SpeedBox";
import { TopBar } from "../components/TopBar";
import { RideInviteSheet } from '../components/RideInviteSheet';
import { SearchBar } from '../components/SearchBar';

import { apiFetch } from '../services/api';
import { API_BASE_URL, GOOGLE_API_GENERAL_KEY } from '@env';

import { useLocation } from '../hooks/useLocation';
import { useDeadReckoning } from '../hooks/useDeadReckoning';
import { useRerouting } from '../hooks/useRerouting';
import { useReporting } from '../hooks/useReporting';
import { useNearbyEvents } from '../hooks/useNearbyEvents';
import { useNearbyFriends } from '../hooks/useNearbyFriends';
import { useRideInvite } from '../hooks/useRideInvite';
import { useWebSocket, useGroupStopListener } from '../hooks/useWebSocket';
import { useLocationBroadcaster } from '../hooks/useLocationBroadcaster';
import { useDislikedAreas } from '../hooks/useDislikedAreas';
import { useTelemetry } from '../hooks/useTelemetry';
import { useActiveRouteSync } from '../hooks/useActiveRouteSync';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useZenSessionSync } from '../hooks/useZenSessionSync';
import { decodePolyline } from '../utils/polyline';

import { useSettingsStore } from '../store/useSettingsStore';

const GOOGLE_API_KEY = GOOGLE_API_GENERAL_KEY;

interface InviteData {
  friendName?: string;
  senderName?: string;
  distance: string;
  eta: string;
  groupId: string;
  othersCount?: number;
  message?: string;
}

export default function MainScreen() {
  const mapRef = useRef<MapView>(null);

  const { speed, heading, coords } = useLocation();
  const speedMs = speed / 3.6;
  useKeepAwake();

  const { activeCoords, isSimulating } = useDeadReckoning(coords, speedMs, heading);

  const [destination, setDestination] = useState<{ latitude: number, longitude: number } | null>(null);
  const [stopDestination, setStopDestination] = useState<{ latitude: number, longitude: number } | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<{ latitude: number, longitude: number }[]>([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distance: number, duration: number } | null>(null);

  const [isSearching, setIsSearching] = useState(false);
  const [searchSessionId, setSearchSessionId] = useState(0);
  const [pendingSearch, setPendingSearch] = useState<{ coords: { latitude: number, longitude: number }, name: string } | null>(null);

  const [isZenSession, setIsZenSession] = useState(false);
  const [zenDestination, setZenDestination] = useState<{ latitude: number, longitude: number } | null>(null);

  const autoStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showRideInvite, setShowRideInvite] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);

  const { isDNDActive, userId, userName, activeGroupId, groupDestination, rendezvousPoint, groupStop, setActiveGroupId, token, setGroupDestination, setGroupStop } = useSettingsStore();
  const { submitReport, isSubmitting } = useReporting();
  const { events, refetchEvents } = useNearbyEvents(activeCoords.latitude || 44.4268, activeCoords.longitude || 26.1025);
  const { friends } = useNearbyFriends(activeCoords.latitude, activeCoords.longitude, isDNDActive, token);
  const { sendInvite } = useRideInvite();

  const { dislikedAreas, addDislike } = useDislikedAreas();

  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ latitude: number, longitude: number } | null>(null);

  const {
    isRerouting,
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

  const currentDestination = groupDestination || destination;

  const currentWaypoints = [];
  if (rendezvousPoint && groupDestination) currentWaypoints.push(rendezvousPoint);
  if (groupStop) currentWaypoints.push(groupStop);
  if (stopDestination) currentWaypoints.push(stopDestination);

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

  const { ws } = useWebSocket(token, activeGroupId, handleIncomingInvite, () => { });

  useGroupStopListener(ws);

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
  usePushNotifications();

  useZenSessionSync(isZenSession, activeCoords.latitude, activeCoords.longitude, () => { });


  const handleAcceptRide = async () => {
    if (!inviteData?.groupId) return;

    try {
      const groupData = await apiFetch(`/groups/${inviteData.groupId}/join`, { method: 'POST' });

      setActiveGroupId(inviteData.groupId);
      setShowRideInvite(false);

      if (groupData.destination) {
        setGroupDestination(groupData.destination);
        if (groupData.stop) setGroupStop(groupData.stop);
        if (isZenSession) {
          setIsZenSession(false);
          setZenDestination(null);
        }

        startNavigationProtocol();
      }

      else if (isZenSession && groupData.allZen) {
        console.log("Joined a shared Zen session");
      }

    } catch (error) {
      console.error("Failed to join ride:", error);
    }
  };

  const handleDeclineRide = () => {
    setShowRideInvite(false);
    setInviteData(null);
  };

  const handleFriendClick = async (friendId: string, friendName: string) => {
    if (isDNDActive || !userId || !userName) {
      return;
    }
    await sendInvite(friendId, userName, activeCoords.latitude, activeCoords.longitude);
  };

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') return true;
    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
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
    return () => {
      if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
    };
  }, []);

  useEffect(() => {
    if (activeCoords.latitude !== 0 && !isSearching && mapRef.current) {
      if (currentDestination && !isNavigating && !isZenSession) return;

      const isDriving = speed > 5 || isSimulating;

      mapRef.current.animateCamera({
        center: activeCoords,
        heading: isDriving ? heading : 0,
        pitch: isDriving || isNavigating || isZenSession ? 60 : 0,
        zoom: isDriving || isNavigating || isZenSession ? 20.5 : 18.5,
      }, { duration: 1000 });
    }
  }, [activeCoords, heading, speed, isSearching, currentDestination, isNavigating, isSimulating, isZenSession]);

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
    setIsNavigating(false);
    setIsSearching(false);
    setSearchSessionId(prev => prev + 1);
    setRouteInfo(null);
    panY.setValue(0);

    if (isZenSession) {
      setIsZenSession(false);
      fetch(`${API_BASE_URL}/api/routes/zen/stop`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }).catch(() => { });
    }
    if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
  };

  const handleOpenSearch = () => {
    if (isZenSession) {
      cancelNavigation();
    }
    setSearchSessionId(prev => prev + 1);
    setIsSearching(true);
  };

  const sendGroupStop = async (groupId: string, coords: { latitude: number, longitude: number }, name: string) => {
    try {
      await apiFetch(`/groups/${groupId}/stop`, {
        method: 'POST',
        body: JSON.stringify({
          latitude: coords.latitude,
          longitude: coords.longitude,
          name: name
        })
      });
      console.log("Group stop shared successfully!");
    } catch (error) {
      console.error("Error sharing group stop:", error);
    }
  };

  const handlePlaceSelect = (destCoords: { latitude: number, longitude: number }, name: string) => {
    if (destination) {
      setPendingSearch({ coords: destCoords, name });
      setIsSearching(false);
    } else {
      setDestination(destCoords);
      startNavigationProtocol();
    }
  };

  const handleSetNewDestination = () => {
    if (!pendingSearch) return;
    setStopDestination(null);
    setDestination(pendingSearch.coords);
    setPendingSearch(null);
    startNavigationProtocol();
  };

  const handleAddStop = () => {
    if (!pendingSearch) return;

    if (activeGroupId) {
      sendGroupStop(activeGroupId, pendingSearch.coords, pendingSearch.name);
    } else {
      setStopDestination(pendingSearch.coords);
    }
    setPendingSearch(null);
    startNavigationProtocol();
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
        heading: heading,
        pitch: 60,
        zoom: 20.5,
      }, { duration: 1000 });
    }
  };

  const handleMapLongPress = (event: any) => {
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
    const success = await addDislike(selectedLocation.latitude, selectedLocation.longitude, "User Manual Block");
    if (success) {
      setIsReportModalVisible(false);
    }
  };

  const toggleZenSession = async () => {
    const newZenState = !isZenSession;
    setIsZenSession(newZenState);

    if (newZenState) {
      setZenDestination(null);
      try {
        const response = await fetch(`${API_BASE_URL}/api/routes/zen/start`, {
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
          throw new Error(`ZenSession API Error ${response.status}: ${text}`);
        }
        const data = JSON.parse(text);
        if (data.next_lat && data.next_lng) {
          setZenDestination({ latitude: data.next_lat, longitude: data.next_lng });
          setIsNavigating(true);
        }
      } catch (error) {
        console.error("ZenSession failed to start:", error);
        setIsZenSession(false);
      }
    } else {
      cancelNavigation();
    }
  };

  useEffect(() => {
    if (!isZenSession || !zenDestination || !token || activeCoords.latitude === 0) return;

    const distM = (() => {
      const R = 6371000;
      const rad = Math.PI / 180;
      const dLat = (zenDestination.latitude - activeCoords.latitude) * rad;
      const dLng = (zenDestination.longitude - activeCoords.longitude) * rad;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(activeCoords.latitude * rad) * Math.cos(zenDestination.latitude * rad) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    })();

    if (distM < 500) {
      fetch(`${API_BASE_URL}/api/routes/zen/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ latitude: activeCoords.latitude, longitude: activeCoords.longitude, heading: heading ?? 0 })
      })
        .then(r => r.json())
        .then(data => {
          if (data.status === 'extended' && data.next_lat && data.next_lng) {
            setZenDestination({ latitude: data.next_lat, longitude: data.next_lng });
          }
        })
        .catch(() => { });
    }
  }, [activeCoords, isZenSession, zenDestination, token]);


  const formatDistance = (dist: number) => dist < 1 ? `${(dist * 1000).toFixed(0)} m` : `${dist.toFixed(1)} km`;
  const formatDuration = (mins: number) => {
    if (mins < 60) return `${Math.ceil(mins)} min`;
    const hours = Math.floor(mins / 60);
    const m = Math.ceil(mins % 60);
    return `${hours} h ${m} m`;
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.topSection} edges={["top"]}>
        <TopBar onZenPress={toggleZenSession} isZenActive={isZenSession} />

        {isSimulating && (
          <View style={styles.simulatingBadge}>
            <Text style={styles.simulatingText}>GPS LOST - SIMULATING</Text>
          </View>
        )}
      </SafeAreaView>

      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          customMapStyle={nightMapStyle}
          initialRegion={region}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          loadingEnabled={true}
          mapPadding={{ top: 0, right: 0, bottom: 120, left: 0 }}
          onLongPress={handleMapLongPress}
        >
          {activeCoords.latitude !== 0 && (
            <Marker
              coordinate={activeCoords}
              anchor={{ x: 0.5, y: 0.5 }}
              flat={true}
              rotation={heading}
            >
              <View style={[styles.customMarkerGlow, isSimulating && { shadowColor: "#EF4444" }]}>
                <Navigation
                  color={isSimulating ? "#EF4444" : (isZenSession ? "#10B981" : "#8A2BE2")}
                  size={45}
                  fill={isSimulating ? "#EF4444" : (isZenSession ? "#10B981" : "#8A2BE2")}
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

          {dislikedAreas?.map((area) => (
            <Circle
              key={area.id}
              center={{ latitude: area.latitude, longitude: area.longitude }}
              radius={200}
              strokeColor="rgba(239, 68, 68, 0.5)"
              fillColor="rgba(239, 68, 68, 0.2)"
            />
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

          {currentDestination && routeOrigin && !isZenSession && (
            <MapViewDirections
              origin={routeOrigin}
              destination={currentDestination}
              waypoints={currentWaypoints.length > 0 ? currentWaypoints : undefined}
              apikey={GOOGLE_API_KEY}
              strokeWidth={8}
              strokeColor="#8A2BE2"
              mode="DRIVING"
              precision="high"
              optimizeWaypoints={true}
              onReady={(result) => {
                setRouteCoordinates(result.coordinates);
                setRouteInfo({ distance: result.distance, duration: result.duration });
                finishRerouting();
              }}
            />
          )}

          {stopDestination && (
            <Marker coordinate={stopDestination} anchor={{ x: 0.5, y: 1 }}>
              <View style={styles.stopDestinationMarker}>
                <MapPin color="#FFF" size={20} />
              </View>
            </Marker>
          )}

          {isZenSession && zenDestination && (
            <MapViewDirections
              origin={activeCoords}
              destination={zenDestination}
              apikey={GOOGLE_API_KEY}
              strokeWidth={8}
              strokeColor="#10B981"
              mode="DRIVING"
              precision="high"
              onReady={(result) => {
                setRouteInfo({ distance: result.distance, duration: result.duration });
              }}
            />
          )}
        </MapView>
      </View>

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

      {!isSearching && (
        <View style={styles.bottomWrapper}>
          {isNavigating && (
            <Animated.View style={[styles.cancelBackground, { opacity: cancelOpacity }]}>
              <XCircle color="white" size={32} />
              <Text style={styles.cancelText}>Release to cancel the route</Text>
            </Animated.View>
          )}

          <Animated.View
            style={[styles.bottomSection, { transform: [{ translateY: panY }] }]}
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

      <Modal visible={!!pendingSearch} transparent animationType="slide">
        <View style={styles.actionSheetOverlay}>
          <View style={styles.actionSheetContent}>
            <Text style={styles.actionSheetTitle}>Active Route Existing</Text>
            <Text style={styles.actionSheetSubtitle}>What do you want to do with {pendingSearch?.name}?</Text>

            <TouchableOpacity style={styles.actionBtnPrimary} onPress={handleSetNewDestination}>
              <Map color="#FFF" size={24} />
              <Text style={styles.actionBtnTextPrimary}>New Destination (Replace)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleAddStop}>
              <MapPin color="#A855F7" size={24} />
              <Text style={styles.actionBtnTextSecondary}>Add as Stop</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setPendingSearch(null)}>
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