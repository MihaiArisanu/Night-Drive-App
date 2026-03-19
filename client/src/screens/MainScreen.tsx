import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, Keyboard, Platform, PermissionsAndroid, StyleSheet } from "react-native";
import MapView, { PROVIDER_GOOGLE, Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, X, MapPin, Navigation } from "lucide-react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import Geolocation from "react-native-geolocation-service";
import MapViewDirections from 'react-native-maps-directions';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';

import { AddEventButton } from "../components/AddEventButton";
import { AddEventModal } from "../components/AddEventModal";
import { IconButton } from "../components/IconButton";
import { SpeedBox } from "../components/SpeedBox";
import { TopBar } from "../components/TopBar";

import { GOOGLE_API_GENERAL_KEY } from '@env';
import { useLocation } from '../hooks/useLocation';
import { useDeadReckoning } from '../hooks/useDeadReckoning';
import { useRerouting } from '../hooks/useRerouting';

const GOOGLE_API_KEY = GOOGLE_API_GENERAL_KEY;

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
    width: '100%'
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