import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Trash2, MapPin, LocateFixed } from 'lucide-react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { useSavedPlaces } from '../hooks/useSavedPlaces';
import { useLocation } from '../hooks/useLocation';
import { GOOGLE_API_GENERAL_KEY } from '@env';

export default function SavedPlacesScreen({ navigation }: any) {
    const { savedPlaces, deletePlace, savePlace } = useSavedPlaces();
    const { coords } = useLocation();
    const [isAdding, setIsAdding] = useState(false);
    const googleRef = useRef<any>(null);

    const handleSaveCurrentLocation = async () => {
        if (coords.latitude && coords.longitude) {
            setIsAdding(true);
            await savePlace(
                "Locație Curentă",
                coords.latitude,
                coords.longitude
            );
            setIsAdding(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ArrowLeft color="white" size={28} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>SAVED PLACES</Text>
                <div style={{ width: 28 }} />
            </View>

            <View style={styles.searchContainer}>
                <GooglePlacesAutocomplete
                    ref={googleRef}
                    placeholder="Search for a place to save..."
                    fetchDetails={true}
                    onPress={async (data, details = null) => {
                        if (details) {
                            setIsAdding(true);
                            await savePlace(
                                data.structured_formatting.main_text,
                                details.geometry.location.lat,
                                details.geometry.location.lng
                            );
                            setIsAdding(false);
                            googleRef.current?.clear();
                        }
                    }}
                    query={{
                        key: GOOGLE_API_GENERAL_KEY,
                        language: 'ro',
                        components: 'country:ro',
                    }}
                    styles={autoCompleteStyles}
                    enablePoweredByContainer={false}
                />

                <TouchableOpacity
                    style={styles.currentLocationRow}
                    onPress={handleSaveCurrentLocation}
                >
                    <LocateFixed color="#A855F7" size={20} />
                    <Text style={styles.currentLocationText}>Salvează locația curentă</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
                {isAdding && <ActivityIndicator color="#A855F7" style={{ marginBottom: 15 }} />}

                {savedPlaces.map((place) => (
                    <View key={place.id} style={styles.card}>
                        <View style={styles.cardLeft}>
                            <MapPin color="#A855F7" size={24} />
                            <View style={styles.info}>
                                <Text style={styles.placeName}>{place.name}</Text>
                                <Text style={styles.placeAddress}>
                                    Lat: {place.latitude.toFixed(4)}, Lng: {place.longitude.toFixed(4)}
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={() => deletePlace(place.id)}>
                            <Trash2 color="#EF4444" size={20} />
                        </TouchableOpacity>
                    </View>
                ))}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
    backButton: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
    searchContainer: {
        paddingHorizontal: 20,
        zIndex: 100,
        marginBottom: 10
    },
    currentLocationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0A0A0A',
        padding: 15,
        borderRadius: 12,
        marginTop: 10,
        borderWidth: 1,
        borderColor: '#1A1A1A',
        gap: 12
    },
    currentLocationText: {
        color: '#A855F7',
        fontSize: 14,
        fontWeight: 'bold'
    },
    content: { padding: 20 },
    card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0A0A0A', padding: 15, borderRadius: 15, marginBottom: 12, borderWidth: 1, borderColor: '#1A1A1A' },
    cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 15, flex: 1 },
    info: { flex: 1 },
    placeName: { color: 'white', fontSize: 15, fontWeight: 'bold' },
    placeAddress: { color: '#666', fontSize: 12 }
});

const autoCompleteStyles = {
    container: { flex: 0 },
    textInput: {
        backgroundColor: '#111',
        color: '#FFF',
        height: 50,
        borderRadius: 12,
        paddingHorizontal: 15,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#222',
    },
    listView: {
        backgroundColor: '#111',
        borderRadius: 12,
        marginTop: 5,
        borderWidth: 1,
        borderColor: '#333',
        zIndex: 1000,
        position: 'absolute',
        top: 50,
        width: '100%'
    },
    row: {
        backgroundColor: '#111',
        padding: 13,
        height: 50,
    },
    description: {
        color: '#CCC',
    },
    separator: {
        backgroundColor: '#222',
    },
};