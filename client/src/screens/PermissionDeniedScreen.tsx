import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, PermissionsAndroid, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertTriangle } from 'lucide-react-native';

export default function PermissionErrorScreen({ navigation }: any) {
    const handleAllowAgain = async () => {
        if (Platform.OS === 'android') {
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
            );
            if (granted === PermissionsAndroid.RESULTS.GRANTED) {
                navigation.replace('Splash');
            }
        } else {
            Linking.openSettings();
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <AlertTriangle color="#ff4444" size={64} style={styles.icon} />
            <Text style={styles.title}>Location Required</Text>
            <Text style={styles.message}>
                We sincerely apologize, but NightDrive relies heavily on your exact location to provide real-time routing and event tracking. The app cannot function without it.
            </Text>

            <TouchableOpacity style={styles.button} onPress={handleAllowAgain}>
                <Text style={styles.buttonText}>Allow Again</Text>
            </TouchableOpacity>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 30 },
    icon: { marginBottom: 20 },
    title: { color: '#FFF', fontSize: 24, fontWeight: 'bold', marginBottom: 15 },
    message: { color: '#888', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
    button: { backgroundColor: '#8A2BE2', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 12 },
    buttonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
});