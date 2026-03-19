import { AlertTriangle, Construction, X } from 'lucide-react-native';
import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface AddEventModalProps {
    isVisible: boolean;
    onClose: () => void;
}

export const AddEventModal = ({ isVisible, onClose }: AddEventModalProps) => {

    const handleSelectEvent = (eventId: string) => {
        console.log(`Event raportat: ${eventId}`);
        onClose();
    };

    const eventTypes = [
        {
            id: 'accident',
            label: 'ACCIDENT',
            icon: <Image
                source={require('../assets/carcrash.png')}
                style={styles.customIcon}
            />,
            color: '#EF4444'
        },
        {
            id: 'police',
            label: 'POLICE',
            icon: <Image
                source={require('../assets/hat.png')}
                style={styles.customIcon}
            />,
            color: '#3B82F6'
        },
        {
            id: 'hazard',
            label: 'HAZARD',
            icon: <AlertTriangle color="white" size={32} />,
            color: '#EAB308'
        },
        {
            id: 'work',
            label: 'WORKS',
            icon: <Construction color="white" size={32} />,
            color: '#F97316'
        },
    ];

    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={isVisible}
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose}>
                <View style={styles.sheet}>
                    <View style={styles.handle} />

                    <View style={styles.header}>
                        <Text style={styles.title}>REPORT EVENT</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <X color="#444" size={24} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.grid}>
                        {eventTypes.map((event) => (
                            <TouchableOpacity
                                key={event.id}
                                style={styles.eventItem}
                                activeOpacity={0.7}
                                onPress={() => handleSelectEvent(event.id)}
                            >
                                <View style={[styles.iconCircle, { borderColor: event.color }]}>
                                    {event.icon}
                                </View>
                                <Text style={styles.eventLabel}>{event.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            </Pressable>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.8)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#0A0A0A',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        padding: 25,
        paddingBottom: 50,
        borderWidth: 1,
        borderColor: '#1A1A1A',
    },
    handle: {
        width: 40,
        height: 4,
        backgroundColor: '#333',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 30,
    },
    title: {
        color: 'white',
        fontSize: 20,
        fontWeight: '900',
        letterSpacing: 2,
    },
    closeButton: {
        padding: 5,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 20,
    },
    eventItem: {
        width: '45%',
        alignItems: 'center',
        marginBottom: 10,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#111',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        marginBottom: 10,
    },
    eventLabel: {
        color: '#888',
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    customIcon: {
        width: 45,
        height: 45,
        resizeMode: 'contain',
    },
});