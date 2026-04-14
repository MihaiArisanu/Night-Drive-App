import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, PermissionsAndroid, LayoutAnimation, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, Users, Zap } from 'lucide-react-native';
import Geolocation from 'react-native-geolocation-service';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function OnboardingScreen({ navigation }: any) {
    const [step, setStep] = useState(0);

    const nextStep = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        if (step < 2) {
            setStep(step + 1);
        } else {
            finishOnboarding();
        }
    };

    const finishOnboarding = () => {
        navigation.replace('Welcome');
    };

    const handleAcceptPermissions = () => {
        setTimeout(async () => {
            try {
                if (Platform.OS === 'android') {
                    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
                } else if (Platform.OS === 'ios') {
                    await Geolocation.requestAuthorization('whenInUse');
                }

                nextStep();
            } catch (error) {
                console.warn(error);
                nextStep(); // Fallback
            }
        }, 150);
    };

    const handleDenyPermissions = () => {
        navigation.replace('PermissionError');
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.content}>

                {step === 0 && (
                    <View style={styles.stepContainer}>
                        <View style={styles.iconCircle}>
                            <MapPin color="#8A2BE2" size={40} />
                        </View>
                        <Text style={styles.title}>Location Access</Text>
                        <Text style={styles.description}>
                            To use NightDrive and enjoy real-time navigation, you need to allow access to your device's location.
                        </Text>
                        <Text style={styles.subDescription}>
                            You can read more details at any time by accessing the Terms and Conditions in the app menu.
                        </Text>

                        <View style={styles.permissionsButtonsRow}>
                            <TouchableOpacity style={styles.btnAccept} onPress={handleAcceptPermissions}>
                                <Text style={styles.btnAcceptText}>ACCEPT</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.btnDeny} onPress={handleDenyPermissions}>
                                <Text style={styles.btnDenyText}>DENY</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {step === 1 && (
                    <View style={styles.stepContainer}>
                        <View style={styles.iconCircle}>
                            <Users color="#8A2BE2" size={40} />
                        </View>
                        <Text style={styles.title}>Ride Groups</Text>
                        <Text style={styles.description}>
                            Create groups with your friends. See each other on the map in real-time, set meeting points (Rendezvous), and add synchronized stops for the whole convoy.
                        </Text>
                    </View>
                )}

                {step === 2 && (
                    <View style={styles.stepContainer}>
                        <View style={styles.iconCircle}>
                            <Zap color="#8A2BE2" size={40} />
                        </View>
                        <Text style={styles.title}>Stay Focused</Text>
                        <Text style={styles.description}>
                            Report potholes, speed cameras, or accidents with a single click. And when you just want to enjoy the drive, activate Zen Session for a completely minimalist interface.
                        </Text>
                    </View>
                )}
            </View>

            {step > 0 && (
                <View style={styles.bottomControls}>
                    <TouchableOpacity onPress={finishOnboarding} style={styles.skipBtn}>
                        <Text style={styles.skipText}>Skip</Text>
                    </TouchableOpacity>

                    <View style={styles.dotsContainer}>
                        <View style={[styles.dot, step === 1 && styles.activeDot]} />
                        <View style={[styles.dot, step === 2 && styles.activeDot]} />
                    </View>

                    <TouchableOpacity onPress={nextStep} style={styles.nextBtn}>
                        <Text style={styles.nextText}>{step === 2 ? "LET'S GO" : "NEXT"}</Text>
                    </TouchableOpacity>
                </View>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 },
    stepContainer: { alignItems: 'center', width: '100%' },
    iconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(138, 43, 226, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 30, borderWidth: 1, borderColor: 'rgba(138, 43, 226, 0.3)' },
    title: { color: '#FFF', fontSize: 28, fontWeight: 'bold', marginBottom: 15, textAlign: 'center', letterSpacing: 1 },
    description: { color: '#AAA', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 20 },
    subDescription: { color: '#666', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 10 },

    permissionsButtonsRow: { flexDirection: 'row', gap: 15, marginTop: 40, width: '100%' },
    btnAccept: { flex: 1, backgroundColor: '#8A2BE2', paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
    btnAcceptText: { color: '#FFF', fontWeight: 'bold', letterSpacing: 1 },
    btnDeny: { flex: 1, backgroundColor: 'transparent', paddingVertical: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
    btnDenyText: { color: '#888', fontWeight: 'bold', letterSpacing: 1 },

    bottomControls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 30, paddingBottom: 20 },
    skipBtn: { padding: 10 },
    skipText: { color: '#666', fontSize: 16, fontWeight: 'bold' },
    nextBtn: { backgroundColor: '#8A2BE2', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 20 },
    nextText: { color: '#FFF', fontSize: 14, fontWeight: 'bold', letterSpacing: 1 },

    dotsContainer: { flexDirection: 'row', gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#333' },
    activeDot: { backgroundColor: '#8A2BE2', width: 20 },
});