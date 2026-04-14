import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Keyboard, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Trash2 } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useDislikedAreas } from '../hooks/useDislikedAreas';
import { SearchBar } from '../components/SearchBar';

export default function DislikedStreetsScreen({ navigation }: any) {
    const { dislikedAreas, removeDislike, addDislike, updateDislike } = useDislikedAreas();
    const [isAdding, setIsAdding] = useState(false);

    const [editingArea, setEditingArea] = useState<any>(null);
    const [editReason, setEditReason] = useState("");

    const handleSaveEdit = async () => {
        if (editingArea && editReason.trim()) {
            if (updateDislike) await updateDislike(editingArea.id, editReason); 
            setEditingArea(null);
            Toast.show({ type: 'error', text1: 'Updated', text2: 'Blocked street reason changed.' });
        }
    };

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
                <SearchBar
                    isCompact={true}
                    searchFilter="address"
                    placeholder="Search street to block..."
                    onClose={() => Keyboard.dismiss()}
                    onPlaceSelect={async (coords, name) => {
                        setIsAdding(true);
                        await addDislike(coords.latitude, coords.longitude, name);
                        setIsAdding(false);

                        Toast.show({
                            type: 'error',
                            text1: 'Street Blocked!',
                            text2: 'Routings will now avoid this area.',
                        });
                    }}
                />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
                {isAdding && <ActivityIndicator color="#EF4444" style={{ marginBottom: 15 }} />}

                {dislikedAreas.map((area) => (
                    <TouchableOpacity 
                        key={area.id} 
                        style={styles.card}
                        activeOpacity={0.7}
                        onLongPress={() => {
                            setEditingArea(area);
                            setEditReason(area.reason);
                        }}
                    >
                        <View style={styles.cardLeft}>
                            <View style={styles.redDot} />
                            <View style={styles.info}>
                                <Text style={styles.placeName}>{area.reason || "Zonă Blocată"}</Text>
                                <Text style={styles.placeAddress}>Ruta va evita această zonă</Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={() => {
                            removeDislike(area.id);
                            Toast.show({ type: 'success', text1: 'Unblocked', text2: 'Street removed from blocklist.' });
                        }}>
                            <Trash2 color="#666" size={20} />
                        </TouchableOpacity>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            <Modal visible={!!editingArea} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Edit Reason</Text>
                        <TextInput 
                            style={styles.input}
                            value={editReason}
                            onChangeText={setEditReason}
                            autoFocus
                        />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity style={styles.btnCancel} onPress={() => setEditingArea(null)}>
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
    redDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#EF4444'
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
        backgroundColor: '#EF4444',
        borderRadius: 10,
        alignItems: 'center'
    },
    btnText: {
        color: 'white',
        fontWeight: 'bold'
    }
});