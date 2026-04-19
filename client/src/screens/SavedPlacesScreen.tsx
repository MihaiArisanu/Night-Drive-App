import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Keyboard, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Trash2, MapPin, LocateFixed, Edit2 } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useSavedPlaces } from '../hooks/useSavedPlaces';
import { useLocation } from '../hooks/useLocation';
import { SearchBar } from '../components/SearchBar';
import { GOOGLE_API_GENERAL_KEY } from '@env';

const AddressDisplay = ({ lat, lng, fallback }: { lat: number; lng: number; fallback: string }) => {
    const [address, setAddress] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_GENERAL_KEY}`)
            .then((res) => res.json())
            .then((data) => {
                if (isMounted && data.status === "OK" && data.results.length > 0) {
                    setAddress(data.results[0].formatted_address);
                }
            })
            .catch(() => { });
        return () => {
            isMounted = false;
        };
    }, [lat, lng]);

    return (
        <Text style={styles.placeAddress} numberOfLines={2}>
            {address || fallback}
        </Text>
    );
};

export default function SavedPlacesScreen({ navigation }: any) {
    const { savedPlaces, deletePlace, savePlace, updatePlace } = useSavedPlaces();
    const { coords } = useLocation();
    const [isAdding, setIsAdding] = useState(false);

    const [editingPlace, setEditingPlace] = useState<any>(null);
    const [editName, setEditName] = useState("");

    const handleSaveEdit = async () => {
        if (editingPlace && editName.trim()) {
            if (updatePlace) await updatePlace(editingPlace.id, editName);
            setEditingPlace(null);
            Toast.show({ type: 'success', text1: 'Updated', text2: 'Location name changed.' });
        }
    };

    const handleSaveCurrentLocation = async () => {
        if (coords.latitude && coords.longitude) {
            setIsAdding(true);
            await savePlace("Locație Curentă", coords.latitude, coords.longitude);
            setIsAdding(false);

            Toast.show({
                type: 'success',
                text1: 'Location Saved!',
                text2: 'Your current location has been added.',
            });
        } else {
            Toast.show({
                type: 'error',
                text1: 'No GPS Signal',
                text2: 'Please wait for a location lock before saving.',
            });
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ArrowLeft color="white" size={28} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>SAVED PLACES</Text>
                <View style={{ width: 28 }} />
            </View>

            <View style={styles.searchContainer}>
                <SearchBar
                    isCompact={true}
                    placeholder="Search for a place to save..."
                    userCoords={coords}
                    onClose={() => Keyboard.dismiss()}
                    onPlaceSelect={async (coords, name) => {
                        setIsAdding(true);
                        await savePlace(name, coords.latitude, coords.longitude);
                        setIsAdding(false);

                        Toast.show({
                            type: 'success',
                            text1: 'Location Saved!',
                            text2: 'Successfully added to your saved places.',
                        });
                    }}
                />

                <TouchableOpacity style={styles.currentLocationRow} onPress={handleSaveCurrentLocation}>
                    <LocateFixed color="#A855F7" size={20} />
                    <Text style={styles.currentLocationText}>Save current location</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
                {isAdding && <ActivityIndicator color="#A855F7" style={{ marginBottom: 15 }} />}

                {savedPlaces.map((place) => (
                    <TouchableOpacity
                        key={place.id}
                        style={styles.card}
                        activeOpacity={0.7}
                        onLongPress={() => {
                            setEditingPlace(place);
                            setEditName(place.name);
                        }}
                    >
                        <View style={styles.cardLeft}>
                            <MapPin color="#A855F7" size={24} />
                            <View style={styles.info}>
                                <Text style={styles.placeName}>{place.name}</Text>
                                <AddressDisplay
                                    lat={place.latitude}
                                    lng={place.longitude}
                                    fallback={`Lat: ${place.latitude.toFixed(4)}, Lng: ${place.longitude.toFixed(4)}`}
                                />
                            </View>
                        </View>
                        <TouchableOpacity onPress={() => {
                            deletePlace(place.id);
                            Toast.show({ type: 'error', text1: 'Deleted', text2: 'Location removed.' });
                        }}>
                            <Trash2 color="#EF4444" size={20} />
                        </TouchableOpacity>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            <Modal visible={!!editingPlace} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Edit Name</Text>
                        <TextInput
                            style={styles.input}
                            value={editName}
                            onChangeText={setEditName}
                            autoFocus
                        />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity style={styles.btnCancel} onPress={() => setEditingPlace(null)}>
                                <Text style={styles.btnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.btnSave} onPress={handleSaveEdit}>
                                <Text style={styles.btnText}>Save</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000'
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10
    },
    headerTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: '900',
        letterSpacing: 1
    },
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
    content: {
        padding: 20
    },
    card: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#0A0A0A',
        padding: 15,
        borderRadius: 15,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#1A1A1A'
    },
    cardLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 15,
        flex: 1
    },
    info: {
        flex: 1
    },
    placeName: {
        color: 'white',
        fontSize: 15,
        fontWeight: 'bold'
    },
    placeAddress: {
        color: '#666',
        fontSize: 12
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.8)',
        justifyContent: 'center',
        padding: 20
    },
    modalContent: {
        backgroundColor: '#111',
        padding: 25,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#333'
    },
    modalTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 15
    },
    input: {
        backgroundColor: '#000',
        color: 'white',
        padding: 15,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#222',
        marginBottom: 20
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 15
    },
    btnCancel: {
        flex: 1,
        padding: 15,
        backgroundColor: '#222',
        borderRadius: 10,
        alignItems: 'center'
    },
    btnSave: {
        flex: 1,
        padding: 15,
        backgroundColor: '#A855F7',
        borderRadius: 10,
        alignItems: 'center'
    },
    btnText: {
        color: 'white',
        fontWeight: 'bold'
    }
});