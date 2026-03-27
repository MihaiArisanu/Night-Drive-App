import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, Keyboard, Platform, PermissionsAndroid, StyleSheet, Modal } from "react-native";
import MapView, { PROVIDER_GOOGLE, Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, X, MapPin, Navigation } from "lucide-react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
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

import { GOOGLE_API_GENERAL_KEY } from '@env';
import { useLocation } from '../hooks/useLocation';
import { useDeadReckoning } from '../hooks/useDeadReckoning';
import { useRerouting } from '../hooks/useRerouting';
import { useReporting } from '../hooks/useReporting';
import { useNearbyEvents } from '../hooks/useNearbyEvents';

const GOOGLE_API_KEY = GOOGLE_API_GENERAL_KEY;

const audioRecorderPlayer = AudioRecorderPlayer;

interface InviteData {
  friendName: string;
  distance: string;
  eta: string;
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
  // NOU: State dinamic pentru informațiile din slider
  const [inviteData, setInviteData] = useState<InviteData | null>(null);

  const { submitReport, isSubmitting } = useReporting();
  const { events, refetchEvents } = useNearbyEvents(activeCoords.latitude || 44.4268, activeCoords.longitude || 26.1025);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ latitude: number, longitude: number } | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

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

  const handleAcceptRide = () => {
    console.log(`Ride Accepted with ${inviteData?.friendName}! Merging routes...`);
    setActiveGroupId("group_spontan_123");
    setShowRideInvite(false);
    setInviteData(null); // Curățăm datele după acceptare
  };

  const handleDeclineRide = () => {
    console.log("Ride Declined.");
    setShowRideInvite(false);
    setInviteData(null);
  };

  // Funcție temporară pentru a simula primirea unei invitații
  // Vom șterge asta când legăm backend-ul
  const simulateIncomingInvite = () => {
    setInviteData({
      friendName: "Andrei",
      distance: "2.5 km",
      eta: "3 min"
    });
    setShowRideInvite(true);
  };

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') return true;
    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn("Permission Error:", err);
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
        (error) => console.log("Location Error:", error.code, error.message),
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
      if (destination && !isNavigating) return;

      const isDriving = speed > 5 || isSimulating;

      mapRef.current.animateCamera({
        center: activeCoords,
        heading: isDriving ? heading : 0,
        pitch: isDriving || isNavigating ? 60 : 0,
        zoom: isDriving || isNavigating ? 20.5 : 18.5,
      }, { duration: 1000 });
    }
  }, [activeCoords, heading, speed, isSearching, destination, isNavigating, isSimulating]);

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
      console.error('Failed to start recording:', error);
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    try {
      const resultUri = await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();
      console.log('Sending audio to server:', resultUri);
    } catch (error) {
      console.error('Failed to stop recording:', error);
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
            <GooglePlacesAutocomplete
              placeholder="Where do you want to go?"
              onPress={(data, details = null) => {
                if (details) {
                  const destCoords = {
                    latitude: details.geometry.location.lat,
                    longitude: details.geometry.location.lng,
                  };

                  setDestination(destCoords);
                  initRouteOrigin(activeCoords);
                  setRouteCoordinates([]);
                  setIsSearching(false);
                  setIsNavigating(false);

                  if (autoStartTimer.current) clearTimeout(autoStartTimer.current);
                  autoStartTimer.current = setTimeout(() => {
                    setIsNavigating(true);
                  }, 5000);
                }
              }}
              query={{ key: GOOGLE_API_KEY, language: "ro", components: "country:ro" }}
              fetchDetails={true}
              enablePoweredByContainer={false}
              styles={searchBarStyles}
              textInputProps={{ placeholderTextColor: "#888", autoFocus: true }}
              renderLeftButton={() => <View style={styles.iconPadding}><Search color="#888" size={20} /></View>}
              renderRightButton={() => (
                <TouchableOpacity onPress={closeSearch} style={styles.iconPadding}>
                  <X color="#888" size={24} />
                </TouchableOpacity>
              )}
              renderRow={(data) => (
                <View style={styles.resultRow}>
                  <MapPin color="#8A2BE2" size={18} style={{ marginRight: 10 }} />
                  <Text style={styles.resultText}>{data.description}</Text>
                </View>
              )}
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

            {destination && routeOrigin && (
              <MapViewDirections
                origin={routeOrigin}
                destination={destination}
                apikey={GOOGLE_API_KEY}
                strokeWidth={8}
                strokeColor="#8A2BE2"
                optimizeWaypoints={true}
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
                onError={(errorMessage) => {
                  console.log('Eroare la rutare: ', errorMessage);
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
            {isRecording && (
              <Text style={styles.pttText}>Transmitting...</Text>
            )}
          </View>
        )}

      </View>

      {!isSearching && (
        <SafeAreaView style={styles.bottomSection} edges={["bottom"]}>
          <View style={styles.contentContainer}>
            <IconButton icon={<Search color="white" size={28} />} onPress={() => setIsSearching(true)} />
            <View style={styles.centerButtonSpacer}>
              {/* NOU: Aici apelăm simularea pentru invitație la simpla apăsare a butonului mov din mijloc (doar pentru test) */}
              <AddEventButton onPress={simulateIncomingInvite} />
            </View>
            <TouchableOpacity onLongPress={cancelNavigation} activeOpacity={0.8}>
              <SpeedBox speed={speed} limit={80} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      <AddEventModal isVisible={isModalVisible} onClose={() => setModalVisible(false)} />

      {/* Modalul de Raportare Long-Press */}
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

      {/* NOU: Componenta de Invitație așezată curat la nivelul Root-ului */}
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
  resultRow: { flexDirection: 'row', alignItems: 'center', padding: 5 },
  resultText: { color: "#FFF", fontSize: 16 },
  bottomSection: {
    backgroundColor: "rgba(10, 10, 10, 0.95)",
    borderTopWidth: 1,
    borderTopColor: "#1A1A1A",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 5, // Pentru a sta corect sub Slider-ul de Invitație (care are zIndex mai mare)
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
  pttText: {
    color: '#EF4444',
    fontWeight: 'bold',
    marginTop: 5,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
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

const searchBarStyles = {
  textInputContainer: { backgroundColor: "#111", height: 60, borderBottomWidth: 1, borderBottomColor: "#222" },
  textInput: { color: "#FFF", fontSize: 18, backgroundColor: "transparent" },
  listView: { backgroundColor: "#000" },
  row: { backgroundColor: "#000", padding: 15, borderBottomColor: "#222", borderBottomWidth: 0.5 },
};

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