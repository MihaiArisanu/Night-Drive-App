import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, MapPinOff, Trash2 } from 'lucide-react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { useDislikedAreas } from '../hooks/useDislikedAreas';
import { GOOGLE_API_GENERAL_KEY } from '@env';

export default function DislikedStreetsScreen({ navigation }: any) {
    const { dislikedAreas, removeDislike, addDislike } = useDislikedAreas();
    const [isAdding, setIsAdding] = useState(false);
    const googleRef = useRef<any>(null);

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ArrowLeft color="white" size={28} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>DISLIKED STREETS</Text>
                <View style={{ width: 28 }} />
            </View>

            <View style={styles.searchContainer}>
                <GooglePlacesAutocomplete
                    ref={googleRef}
                    placeholder="Search street to block..."
                    fetchDetails={true}
                    onPress={async (data, details = null) => {
                        if (details) {
                            setIsAdding(true);
                            await addDislike(
                                details.geometry.location.lat,
                                details.geometry.location.lng,
                                data.description
                            );
                            setIsAdding(false);
                            googleRef.current?.clear();
                        }
                    }}
                    query={{
                        key: GOOGLE_API_GENERAL_KEY,
                        language: 'ro',
                    }}
                    styles={autoCompleteStyles}
                    enablePoweredByContainer={false}
                />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
                {isAdding && <ActivityIndicator color="#EF4444" style={{ marginBottom: 15 }} />}

                {dislikedAreas.map((area) => (
                    <View key={area.id} style={styles.card}>
                        <View style={styles.cardLeft}>
                            <View style={styles.redDot} />
                            <View style={styles.info}>
                                <Text style={styles.placeName}>{area.reason || "Zonă Blocată"}</Text>
                                <Text style={styles.placeAddress}>Ruta va evita această zonă</Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={() => removeDislike(area.id)}>
                            <Trash2 color="#666" size={20} />
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
    content: { padding: 20 },
    card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0A0A0A', padding: 15, borderRadius: 15, marginBottom: 12, borderWidth: 1, borderColor: '#1A1A1A' },
    cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 15, flex: 1 },
    info: { flex: 1 },
    placeName: { color: 'white', fontSize: 15, fontWeight: 'bold' },
    placeAddress: { color: '#666', fontSize: 12 },
    redDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' }
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