import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Keyboard, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { Search, X, MapPin, Zap, Fuel, Star, Bookmark } from 'lucide-react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { GOOGLE_API_GENERAL_KEY } from '@env';
import { useLocation } from '../hooks/useLocation';
import { useNearbyPlaces, PlaceResult } from '../hooks/useNearbyPlaces';
import { useSavedPlaces } from '../hooks/useSavedPlaces';

interface SearchBarProps {
    onClose: () => void;
    onPlaceSelect: (coords: { latitude: number; longitude: number }, name: string) => void;
}

type SearchTab = 'none' | 'gas' | 'ev' | 'gas_ev' | 'saved';

export function SearchBar({ onClose, onPlaceSelect }: SearchBarProps) {
    const [activeTab, setActiveTab] = useState<SearchTab>('none');
    const { coords } = useLocation();

    const { places, isLoading, error } = useNearbyPlaces(coords.latitude, coords.longitude, activeTab);
    const { savedPlaces, isLoadingPlaces, savePlace } = useSavedPlaces();

    const [placeToSave, setPlaceToSave] = useState<{ name: string; lat: number; lng: number } | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleTabPress = (tab: 'gas' | 'ev' | 'saved') => {
        Keyboard.dismiss();
        if (tab === 'gas') {
            setActiveTab(prev => prev === 'ev' ? 'gas_ev' : prev === 'gas_ev' ? 'ev' : prev === 'gas' ? 'none' : 'gas');
        } else if (tab === 'ev') {
            setActiveTab(prev => prev === 'gas' ? 'gas_ev' : prev === 'gas_ev' ? 'gas' : prev === 'ev' ? 'none' : 'ev');
        } else {
            setActiveTab(prev => prev === 'saved' ? 'none' : 'saved');
        }
    };

    const handleConfirmSave = async () => {
        if (!placeToSave) return;
        setIsSaving(true);

        const success = await savePlace(placeToSave.name, placeToSave.lat, placeToSave.lng);

        setIsSaving(false);
        if (success) {
            setPlaceToSave(null);
        } else {
            alert("Failed to save location. Please try again.");
        }
    };

    const renderPlaceItem = (place: PlaceResult) => {
        const isEV = activeTab === 'ev' || (activeTab === 'gas_ev' && place.name.toLowerCase().includes('charge'));

        return (
            <TouchableOpacity
                key={place.id}
                style={[styles.placeItem, place.isSponsored && styles.sponsoredItem]}
                onPress={() => onPlaceSelect({ latitude: place.latitude, longitude: place.longitude }, place.name)}
            >
                <View style={styles.placeIconContainer}>
                    {isEV ? <Zap color="#10B981" size={24} /> : <Fuel color="#EF4444" size={24} />}
                </View>
                <View style={styles.placeDetails}>
                    <View style={styles.placeHeader}>
                        <Text style={[styles.placeName, place.isSponsored && styles.sponsoredText]} numberOfLines={1}>
                            {place.name}
                        </Text>
                        {place.hasHydrogen && (
                            <View style={styles.hydrogenBadge}>
                                <Text style={styles.hydrogenText}>H2</Text>
                            </View>
                        )}
                    </View>
                    <Text style={styles.placeAddress} numberOfLines={1}>{place.address}</Text>
                    {place.isSponsored && <Text style={styles.sponsoredLabel}>Sponsored by Partner</Text>}
                </View>
            </TouchableOpacity>
        );
    };

    const renderSavedItem = (savedPlace: any) => (
        <TouchableOpacity
            key={savedPlace.id}
            style={styles.placeItem}
            onPress={() => onPlaceSelect({ latitude: savedPlace.latitude, longitude: savedPlace.longitude }, savedPlace.name)}
        >
            <View style={styles.savedIconContainer}>
                <Bookmark color="#F59E0B" size={24} />
            </View>
            <View style={styles.placeDetails}>
                <Text style={styles.placeName} numberOfLines={1}>{savedPlace.name}</Text>
                <Text style={styles.placeAddress} numberOfLines={1}>Saved Location</Text>
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <GooglePlacesAutocomplete
                placeholder={activeTab === 'saved' ? "Search for a place to save..." : "Where do you want to go?"}
                onPress={(data, details = null) => {
                    if (details) {
                        if (activeTab === 'saved') {
                            setPlaceToSave({
                                name: data.description,
                                lat: details.geometry.location.lat,
                                lng: details.geometry.location.lng
                            });
                        } else {
                            onPlaceSelect(
                                { latitude: details.geometry.location.lat, longitude: details.geometry.location.lng },
                                data.description
                            );
                        }
                    }
                }}
                query={{ key: GOOGLE_API_GENERAL_KEY, language: "en", components: "country:ro" }}
                fetchDetails={true}
                enablePoweredByContainer={false}
                styles={searchBarStyles}
                textInputProps={{ placeholderTextColor: "#888", autoFocus: true }}
                renderLeftButton={() => (
                    <View style={styles.iconPadding}>
                        <Search color="#888" size={20} />
                    </View>
                )}
                renderRightButton={() => (
                    <TouchableOpacity onPress={onClose} style={styles.iconPadding}>
                        <X color="#888" size={24} />
                    </TouchableOpacity>
                )}
                renderRow={(data) => (
                    <View style={styles.resultRow}>
                        <MapPin color={activeTab === 'saved' ? "#F59E0B" : "#8A2BE2"} size={18} style={{ marginRight: 10 }} />
                        <Text style={styles.resultText}>{data.description}</Text>
                    </View>
                )}
            />

            <View style={styles.filterContainer}>
                <TouchableOpacity style={[styles.filterBtn, (activeTab === 'gas' || activeTab === 'gas_ev') && styles.filterBtnActive]} onPress={() => handleTabPress('gas')}>
                    <Text style={[styles.filterBtnText, (activeTab === 'gas' || activeTab === 'gas_ev') && styles.filterBtnTextActive]}>⛽ Gas</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, (activeTab === 'ev' || activeTab === 'gas_ev') && styles.filterBtnActive]} onPress={() => handleTabPress('ev')}>
                    <Text style={[styles.filterBtnText, (activeTab === 'ev' || activeTab === 'gas_ev') && styles.filterBtnTextActive]}>⚡ EV</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, activeTab === 'saved' && styles.filterBtnActive]} onPress={() => handleTabPress('saved')}>
                    <Text style={[styles.filterBtnText, activeTab === 'saved' && styles.filterBtnTextActive]}>⭐ Saved</Text>
                </TouchableOpacity>
            </View>

            {activeTab !== 'none' && (
                <View style={styles.resultsContainer}>
                    {activeTab === 'saved' ? (
                        isLoadingPlaces ? (
                            <View style={styles.centerContent}>
                                <ActivityIndicator size="large" color="#F59E0B" />
                            </View>
                        ) : savedPlaces.length === 0 ? (
                            <View style={styles.centerContent}>
                                <Star color="#F59E0B" size={48} style={{ marginBottom: 10, opacity: 0.5 }} />
                                <Text style={styles.emptyStateText}>You haven't saved any locations yet.</Text>
                                <Text style={styles.emptyStateSubtext}>Search for a place above to save it.</Text>
                            </View>
                        ) : (
                            <ScrollView keyboardShouldPersistTaps="handled">
                                {savedPlaces.map(renderSavedItem)}
                            </ScrollView>
                        )
                    ) : (
                        isLoading ? (
                            <View style={styles.centerContent}>
                                <ActivityIndicator size="large" color="#8A2BE2" />
                                <Text style={styles.loadingText}>Searching nearby...</Text>
                            </View>
                        ) : error ? (
                            <View style={styles.centerContent}>
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : (
                            <ScrollView keyboardShouldPersistTaps="handled">
                                {places.map(renderPlaceItem)}
                            </ScrollView>
                        )
                    )}
                </View>
            )}

            {/* POP-UP (Modal) PENTRU SALVAREA LOCAȚIEI */}
            <Modal visible={!!placeToSave} transparent={true} animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalIconBox}>
                            <Star color="#F59E0B" size={32} fill="#F59E0B" />
                        </View>
                        <Text style={styles.modalTitle}>Save Location?</Text>
                        <Text style={styles.modalAddress} numberOfLines={2}>
                            {placeToSave?.name}
                        </Text>

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={styles.modalCancelBtn}
                                onPress={() => setPlaceToSave(null)}
                                disabled={isSaving}
                            >
                                <Text style={styles.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.modalSaveBtn}
                                onPress={handleConfirmSave}
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <ActivityIndicator color="#000" size="small" />
                                ) : (
                                    <Text style={styles.modalSaveText}>Save Place</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#000"
    },
    iconPadding: {
        justifyContent: 'center',
        paddingHorizontal: 15
    },
    resultRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15
    },
    resultText: {
        color: "#FFF",
        fontSize: 16
    },
    filterContainer: {
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        paddingVertical: 12,
        backgroundColor: '#0A0A0A',
        borderBottomWidth: 1,
        borderBottomColor: '#222'
    },
    filterBtn: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        backgroundColor: '#111',
        borderWidth: 1,
        borderColor: '#333'
    },
    filterBtnActive: {
        backgroundColor: '#222',
        borderColor: '#8A2BE2'
    },
    filterBtnText: {
        color: '#888',
        fontWeight: 'bold'
    },
    filterBtnTextActive: {
        color: '#8A2BE2'
    },
    resultsContainer: {
        flex: 1,
        backgroundColor: '#050505'
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        minHeight: 200
    },
    loadingText: {
        color: '#888',
        marginTop: 10,
        fontSize: 14
    },
    errorText: {
        color: '#EF4444',
        textAlign: 'center',
        fontSize: 16
    },
    emptyStateText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center'
    },
    emptyStateSubtext: {
        color: '#888',
        fontSize: 14,
        textAlign: 'center',
        marginTop: 5
    },
    placeItem: {
        flexDirection: 'row',
        padding: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#1A1A1A',
        alignItems: 'center'
    },
    sponsoredItem: {
        backgroundColor: 'rgba(138, 43, 226, 0.05)',
        borderLeftWidth: 3,
        borderLeftColor: '#8A2BE2'
    },
    placeIconContainer: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#111',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 15
    },
    savedIconContainer: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 15,
        borderWidth: 1,
        borderColor: 'rgba(245, 158, 11, 0.3)'
    },
    placeDetails: {
        flex: 1
    },
    placeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between'
    },
    placeName: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
        flex: 1,
        marginRight: 10
    },
    sponsoredText: {
        color: '#A855F7'
    },
    placeAddress: {
        color: '#888',
        fontSize: 12,
        marginTop: 4
    },
    sponsoredLabel: {
        color: '#8A2BE2',
        fontSize: 10,
        fontWeight: 'bold',
        marginTop: 4,
        textTransform: 'uppercase'
    },
    hydrogenBadge: {
        backgroundColor: '#3B82F6',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10
    },
    hydrogenText: {
        color: '#FFF',
        fontSize: 10,
        fontWeight: 'bold'
    },

    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.8)',
        justifyContent: 'center',
        alignItems: 'center'
    },
    modalContent: {
        width: '85%',
        backgroundColor: '#111',
        borderRadius: 20,
        padding: 25,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#333'
    },
    modalIconBox: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 15
    },
    modalTitle: {
        color: '#FFF',
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 10
    },
    modalAddress: {
        color: '#888',
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 25
    },
    modalButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        gap: 15
    },
    modalCancelBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: '#222',
        alignItems: 'center'
    },
    modalCancelText: {
        color: '#FFF',
        fontWeight: 'bold'
    },
    modalSaveBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: '#F59E0B',
        alignItems: 'center'
    },
    modalSaveText: {
        color: '#000',
        fontWeight: 'bold'
    },
});

const searchBarStyles = {
    textInputContainer: {
        backgroundColor: "#111",
        height: 60,
        borderBottomWidth: 1,
        borderBottomColor: "#222"
    },
    textInput: {
        color: "#FFF",
        fontSize: 18,
        backgroundColor: "transparent"
    },
    listView: {
        backgroundColor: "#000"
    },
    row: {
        backgroundColor: "#000",
        borderBottomColor: "#222",
        borderBottomWidth: 0.5
    },
};