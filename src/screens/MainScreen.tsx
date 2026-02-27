import React, { useState, useEffect, useRef } from "react";
import { StyleSheet, View, Text, TouchableOpacity, Keyboard, Platform, PermissionsAndroid } from "react-native";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, X, MapPin } from "lucide-react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import Geolocation from "react-native-geolocation-service";
import { AddEventButton } from "../components/AddEventButton";
import { AddEventModal } from "../components/AddEventModal";
import { IconButton } from "../components/IconButton";
import { SpeedBox } from "../components/SpeedBox";
import { TopBar } from "../components/TopBar";
import { GOOGLE_API_GENERAL_KEY } from '@env';

const GOOGLE_API_KEY = GOOGLE_API_GENERAL_KEY;

export default function MainScreen() {
  const mapRef = useRef<MapView | null>(null);
  const [isModalVisible, setModalVisible] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const [hasPermission, setHasPermission] = useState(false);

  const [region, setRegion] = useState({
    latitude: 44.4268,
    longitude: 26.1025,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') return true;

    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ]);

      const fineGranted = granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
      const coarseGranted = granted[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;

      return fineGranted || coarseGranted;
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  const getCurrentLocation = async () => {
    const permissionGranted = await requestLocationPermission();

    setHasPermission(permissionGranted);

    if (!permissionGranted) return;

    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const newRegion = {
          latitude,
          longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        };
        setRegion(newRegion);
        if (!isSearching) {
          mapRef.current?.animateToRegion(newRegion, 1000);
        }
      },
      (error) => console.log("Eroare Locatie:", error.message),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
    );
  };

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const closeSearch = () => {
    setIsSearching(false);
    Keyboard.dismiss();
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.topSection} edges={["top"]}>
        <TopBar />
      </SafeAreaView>

      <View style={styles.mapContainer}>
        {isSearching ? (
          <View style={styles.searchContainer}>
            <GooglePlacesAutocomplete
              placeholder="Unde vrei să ajungi?"
              onPress={(data, details = null) => {
                if (details) {
                  const newLoc = {
                    latitude: details.geometry.location.lat,
                    longitude: details.geometry.location.lng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  };
                  setRegion(newLoc);
                  setIsSearching(false);
                  setTimeout(() => mapRef.current?.animateToRegion(newLoc, 1000), 100);
                }
              }}
              query={{ key: GOOGLE_API_KEY, language: "ro" }}
              fetchDetails={true}
              enablePoweredByContainer={false}
              styles={searchBarStyles}
              textInputProps={{
                placeholderTextColor: "#888",
                autoFocus: true,
              }}
              renderLeftButton={() => (
                <View style={styles.iconPadding}><Search color="#888" size={20} /></View>
              )}
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
            showsUserLocation={hasPermission}
          />
        )}
      </View>

      {!isSearching && (
        <SafeAreaView style={styles.bottomSection} edges={["bottom"]}>
          <View style={styles.contentContainer}>
            <IconButton
              icon={<Search color="white" size={28} />}
              onPress={() => setIsSearching(true)}
            />
            <View style={styles.centerButtonSpacer}>
              <AddEventButton onPress={() => setModalVisible(true)} />
            </View>
            <SpeedBox speed={0} limit={80} />
          </View>
        </SafeAreaView>
      )}

      <AddEventModal isVisible={isModalVisible} onClose={() => setModalVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  topSection: { backgroundColor: "#000" },
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
  },
  contentContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 25,
    paddingTop: 15,
    paddingBottom: 20,
  },
  centerButtonSpacer: { flex: 1, alignItems: "center" },
});

const searchBarStyles = {
  textInputContainer: { backgroundColor: "#111", height: 60, borderBottomWidth: 1, borderBottomColor: "#222" },
  textInput: { color: "#FFF", fontSize: 18, backgroundColor: "transparent" },
  listView: { backgroundColor: "#000" },
  row: { backgroundColor: "#000", padding: 15, borderBottomColor: "#222", borderBottomWidth: 0.5 },
};

const nightMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#8A2BE2" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] }
];