import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function WelcomeScreen({ navigation }: any) {
    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.topHalf}>
                <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />
                <Text style={styles.appName}>NightDrive</Text>
                <Text style={styles.tagline}>Own the night. Drive safe.</Text>
            </View>

            <View style={styles.bottomHalf}>
                <TouchableOpacity
                    style={styles.loginButton}
                    onPress={() => navigation.navigate('Auth', { isLogin: true })}
                >
                    <Text style={styles.loginText}>Log In</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.registerButton}
                    onPress={() => navigation.navigate('Auth', { isLogin: false })}
                >
                    <Text style={styles.registerText}>Sign Up</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    topHalf: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    logo: { width: 120, height: 120, marginBottom: 15 },
    appName: { color: '#8A2BE2', fontSize: 36, fontWeight: 'bold' },
    tagline: { color: '#888', fontSize: 16, marginTop: 10 },
    bottomHalf: { padding: 30, paddingBottom: 50 },
    loginButton: { backgroundColor: '#8A2BE2', padding: 18, borderRadius: 12, alignItems: 'center', marginBottom: 15 },
    loginText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
    registerButton: { backgroundColor: 'transparent', padding: 18, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#8A2BE2' },
    registerText: { color: '#8A2BE2', fontSize: 18, fontWeight: 'bold' },
});