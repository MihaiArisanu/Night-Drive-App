import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, Keyboard, Platform, PermissionsAndroid, StyleSheet, Modal } from "react-native";
import MapView, { PROVIDER_GOOGLE, Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, MapPin, Navigation, Users } from "lucide-react-native";
import Geolocation from "react-native-geolocation-service";
import MapViewDirections from 'react-native-maps-directions';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

import { AddEventButton } from "../components/AddEventButton";
import { AddEventModal } from "../components/AddEventModal";
import { IconButton } from "../components/IconButton";
import { SpeedBox } from "../components/SpeedBox";
import { TopBar } from "../components/TopBar";
import { RideInviteSheet } from '../components/RideInviteSheet';
import { SearchBar } from '../components/SearchBar';

import { GOOGLE_API_GENERAL_KEY, API_BASE_URL } from '@env';
import { useLocation } from '../hooks/useLocation';
import { useDeadReckoning } from '../hooks/useDeadReckoning';
import { useRerouting } from '../hooks/useRerouting';
import { useReporting } from '../hooks/useReporting';
import { useNearbyEvents } from '../hooks/useNearbyEvents';
import { useNearbyFriends } from '../hooks/useNearbyFriends';
import { useRideInvite } from '../hooks/useRideInvite';
import { useWebSocket } from '../hooks/useWebSocket';
import { useLocationBroadcaster } from '../hooks/useLocationBroadcaster';

import { useSettingsStore } from '../store/useSettingsStore';

const GOOGLE_API_KEY = GOOGLE_API_GENERAL_KEY;

const audioRecorderPlayer = AudioRecorderPlayer;

interface InviteData {
  friendName: string;
  distance: string;
  eta: string;
  groupId: string;
}

export default function MainScreen() {
  const mapRef = useRef<MapView>(null);

  const { speed, heading, coords } = useLocation();
  const speedMs = speed / 3.6;
  useKeepAwake();

  const { activeCoords, isSimulating } = useDeadReckoning(coords, speedMs, heading);
  const [destination, setDestination] = useState<{ latitude: number, longitude: number } | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<{ latitude: number, longitude: number }[]>([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const autoStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showRideInvite, setShowRideInvite] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);

  const { isDNDActive, userId, userName, activeGroupId, groupDestination, rendezvousPoint, setActiveGroupId, token } = useSettingsStore();

  const { submitReport, isSubmitting } = useReporting();
  const { events, refetchEvents } = useNearbyEvents(activeCoords.latitude || 44.4268, activeCoords.longitude || 26.1025);
  const { friends } = useNearbyFriends(activeCoords.latitude, activeCoords.longitude, isDNDActive);
  const { sendInvite } = useRideInvite();

  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ latitude: number, longitude: number } | null>(null);

  const [isRecording, setIsRecording] = useState(false);

  const {
    isRerouting,
    routeOrigin,
    initRouteOrigin,
    finishRerouting,
    resetRouteOrigin
  } = useRerouting(activeCoords, routeCoordinates, isNavigating, 50);

  const [isModalVisible, setModalVisible] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [region, setRegion] = useState({
    latitude: 44.4268,
    longitude: 26.1025,
    latitudeDelta: 0.002,
    longitudeDelta: 0.002,
  });

  const currentDestination = groupDestination || destination;
  const currentWaypoints = rendezvousPoint && groupDestination ? [rendezvousPoint] : undefined;

  const handleIncomingInvite = (data: InviteData) => {
    if (isDNDActive) {
      return;
    }
    setInviteData(data);
    setShowRideInvite(true);
  };

  const handleIncomingVoice = async (data: { audioUrl: string; senderName: string }) => {
    if (isDNDActive) return;
    try {
      await audioRecorderPlayer.startPlayer(data.audioUrl);
      audioRecorderPlayer.addPlayBackListener((e) => {
        if (e.currentPosition === e.duration) {
          audioRecorderPlayer.stopPlayer();
          audioRecorderPlayer.removePlayBackListener();
        }
      });
    } catch (error) {
    }
  };

  useWebSocket(token, activeGroupId, handleIncomingInvite, handleIncomingVoice);

  useLocationBroadcaster(
    userId,
    token,
    activeCoords.latitude,
    activeCoords.longitude,
    heading,
    speedMs,
    isDNDActive
  );

  const handleAcceptRide = () => {
    if (inviteData?.groupId) {
      setActiveGroupId(inviteData.groupId);
    }
    setShowRideInvite(false);
    setInviteData(null);
  };

  const handleDeclineRide = () => {
    setShowRideInvite(false);
    setInviteData(null);
  };

  const handleFriendClick = async (friendId: string, friendName: string) => {
    if (isDNDActive || !userId || !userName) {
      return;
    }

    const result = await sendInvite(friendId, userName, activeCoords.latitude, activeCoords.longitude);
    if (result.success) {
    }
  };

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') return true;
    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
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
      audioRecorderPlayer.stopPlayer();
      audioRecorderPlayer.removePlayBackListener();
    };
  }, []);

  useEffect(() => {
    if (activeCoords.latitude !== 0 && !isSearching && mapRef.current) {
      if (currentDestination && !isNavigating) return;

      const isDriving = speed > 5 || isSimulating;

      mapRef.current.animateCamera({
        center: activeCoords,
        heading: isDriving ? heading : 0,
        pitch: isDriving || isNavigating ? 60 : 0,
        zoom: isDriving || isNavigating ? 20.5 : 18.5,
      }, { duration: 1000 });
    }
  }, [activeCoords, heading, speed, isSearching, currentDestination, isNavigating, isSimulating]);

  const closeSearch = () => {
    setIsSearching(false);
    Keyboard.dismiss();
  };

  const cancelNavigation = () => {
    setDestination(null);
    resetRouteOrigin();
    setRouteCoordinates([]);
    setIsNavigating(false);
    if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
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

  const startRecording = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
    setIsRecording(true);
    try {
      await audioRecorderPlayer.startRecorder();
    } catch (error) {
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    try {
      const resultUri = await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();

      if (!activeGroupId || !userId) return;

      const formData = new FormData();
      formData.append('audio', {
        uri: resultUri,
        type: 'audio/mp4',
        name: `voice_${userId}_${Date.now()}.mp4`,
      } as any);
      formData.append('groupId', activeGroupId);
      formData.append('senderId', userId);
      if (userName) formData.append('senderName', userName);

      await fetch(`${API_BASE_URL}/api/groups/voice`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${token}`
        },
      });
    } catch (error) {
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.topSection} edges={["top"]}>
        <TopBar />

        {isSimulating && (
          <View style={styles.simulatingBadge}>
            <Text style={styles.simulatingText}>GPS LOST - SIMULATING</Text>
          </View>
        )}
      </SafeAreaView>

      <View style={styles.mapContainer}>
        {isSearching ? (
          <View style={styles.searchContainer}>
            <SearchBar
              onClose={closeSearch}
              onPlaceSelect={(destCoords, name) => {
                setDestination(destCoords);
                initRouteOrigin(activeCoords);
                setRouteCoordinates([]);
                setIsSearching(false);
                setIsNavigating(false);

                if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
                autoStartTimer.current = setTimeout(() => {
                  setIsNavigating(true);
                }, 5000);
              }}
            />
          </View>
        ) : (
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
                  <Navigation color={isSimulating ? "#EF4444" : "#8A2BE2"} size={45} fill={isSimulating ? "#EF4444" : "#8A2BE2"} />
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

            {currentDestination && routeOrigin && (
              <MapViewDirections
                origin={routeOrigin}
                destination={currentDestination}
                waypoints={currentWaypoints}
                apikey={GOOGLE_API_KEY}
                strokeWidth={8}
                strokeColor="#8A2BE2"
                optimizeWaypoints={true}
                splitWaypoints={true}
                onReady={(result) => {
                  setRouteCoordinates(result.coordinates);
                  finishRerouting();

                  if (!isNavigating) {
                    mapRef.current?.fitToCoordinates(result.coordinates, {
                      edgePadding: { right: 50, bottom: 200, left: 50, top: 100 },
                      animated: true,
                    });
                  }
                }}
                onError={() => {
                  finishRerouting();
                }}
              />
            )}
          </MapView>
        )}

        {!isSearching && (
          <TouchableOpacity style={styles.recenterBtn} onPress={recenterMap}>
            <Text style={styles.recenterIcon}>📍</Text>
          </TouchableOpacity>
        )}

        {!isSearching && activeGroupId && (
          <View style={styles.pttContainer}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPressIn={startRecording}
              onPressOut={stopRecording}
              style={[
                styles.pttBtn,
                isRecording ? styles.pttBtnActive : styles.pttBtnIdle
              ]}
            >
              <Text style={styles.pttIcon}>{isRecording ? '🎙️' : '🎤'}</Text>
            </TouchableOpacity>
          </View>
        )}

      </View>

      {!isSearching && (
        <SafeAreaView style={styles.bottomSection} edges={["bottom"]}>
          <View style={styles.contentContainer}>
            <IconButton icon={<Search color="white" size={28} />} onPress={() => setIsSearching(true)} />
            <View style={styles.centerButtonSpacer}>
              <AddEventButton onPress={() => setModalVisible(true)} />
            </View>
            <TouchableOpacity onLongPress={cancelNavigation} activeOpacity={0.8}>
              <SpeedBox speed={speed} limit={80} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

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
  bottomSection: {
    backgroundColor: "rgba(10, 10, 10, 0.95)",
    borderTopWidth: 1,
    borderTopColor: "#1A1A1A",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 5,
  },
  contentContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 25,
    paddingTop: 15,
    paddingBottom: 20,
  },
  centerButtonSpacer: { flex: 1, alignItems: "center" },
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
  recenterBtn: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    width: 55,
    height: 55,
    backgroundColor: '#111',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
  recenterIcon: {
    fontSize: 24,
  },
  pttContainer: {
    position: 'absolute',
    bottom: 110,
    alignSelf: 'center',
    alignItems: 'center',
  },
  pttBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    elevation: 8,
  },
  pttBtnIdle: {
    backgroundColor: '#1A1A1A',
    borderColor: '#333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },
  pttBtnActive: {
    backgroundColor: '#EF4444',
    borderColor: '#F87171',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 15,
  },
  pttIcon: {
    fontSize: 28,
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
    width: '30%',
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