import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch, AuthStorage } from '../services/api';

const generateHexTag = (): string => {
    return Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
};

export default function AuthScreen({ route, navigation }: any) {
    const initialIsLogin = route.params?.isLogin ?? true;

    const [isLogin, setIsLogin] = useState(initialIsLogin);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [tag, setTag] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!isLogin) {
            setTag(generateHexTag());
        }
    }, [isLogin]);

    const handleSubmit = async () => {
        if (!email || !password || (!isLogin && !username)) {
            Alert.alert('Error', 'Please fill in all fields.');
            return;
        }

        setIsLoading(true);

        try {
            if (isLogin) {
                const data = await apiFetch('/login', {
                    method: 'POST',
                    body: JSON.stringify({ email, password }),
                });

                await AuthStorage.saveToken(data.token);

                navigation.replace('Main');
            } else {
                await apiFetch('/users', {
                    method: 'POST',
                    body: JSON.stringify({
                        username,
                        tag: tag,
                        email,
                        password
                    }),
                });

                Alert.alert('Success!', `Account created with tag #${tag}. You can now log in.`);
                setIsLogin(true);
                setPassword('');
                setUsername('');
            }
        } catch (error: any) {
            Alert.alert('Authentication Error', error.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={styles.content}
            >
                <View style={styles.header}>
                    <Text style={styles.title}>NightDrive</Text>
                    <Text style={styles.subtitle}>
                        {isLogin ? 'Log in to join the network' : 'Become a NightRider'}
                    </Text>
                </View>

                <View style={styles.form}>
                    {!isLogin && (
                        <>
                            <TextInput
                                style={styles.input}
                                placeholder="Username"
                                placeholderTextColor="#888"
                                value={username}
                                onChangeText={setUsername}
                                autoCapitalize="none"
                            />
                            <View style={[styles.input, styles.disabledInput]}>
                                <Text style={{ color: '#8A2BE2', fontWeight: 'bold' }}>
                                    Your Unique Tag: #{tag}
                                </Text>
                            </View>
                        </>
                    )}

                    <TextInput
                        style={styles.input}
                        placeholder="Email"
                        placeholderTextColor="#888"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                    />
                    <TextInput
                        style={styles.input}
                        placeholder="Password"
                        placeholderTextColor="#888"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />

                    <TouchableOpacity
                        style={[styles.button, isLoading && { opacity: 0.7 }]}
                        onPress={handleSubmit}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <Text style={styles.buttonText}>
                                {isLogin ? 'Hit the Road' : 'Create Account'}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>

                <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={styles.switchButton}>
                    <Text style={styles.switchText}>
                        {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Log In"}
                    </Text>
                </TouchableOpacity>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000'
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        padding: 25
    },
    header: {
        alignItems: 'center',
        marginBottom: 40
    },
    title: {
        fontSize: 42,
        color: '#8A2BE2',
        fontWeight: 'bold',
        letterSpacing: 2
    },
    subtitle: {
        color: '#888',
        fontSize: 16,
        marginTop: 10
    },
    form: {
        width: '100%'
    },
    input: {
        backgroundColor: '#111',
        color: '#FFF',
        padding: 18,
        borderRadius: 12,
        marginBottom: 15,
        borderWidth: 1,
        borderColor: '#222',
        fontSize: 16
    },
    disabledInput: {
        borderColor: '#8A2BE233',
        justifyContent: 'center',
        backgroundColor: '#0A0A0A'
    },
    button: {
        backgroundColor: '#8A2BE2',
        padding: 18,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 10,
        shadowColor: '#8A2BE2',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 5
    },
    buttonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold'
    },
    switchButton: {
        marginTop: 25,
        alignItems: 'center'
    },
    switchText: {
        color: '#8A2BE2',
        fontSize: 16
    },
});