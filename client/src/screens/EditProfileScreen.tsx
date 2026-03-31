import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Image, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Camera, Mail, User } from "lucide-react-native";
import { ActionButton } from "../components/ActionButton";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettingsStore } from '../store/useSettingsStore';
import { API_BASE_URL } from '@env';

export default function EditProfileScreen({ navigation }: any) {
    const { currentUser, refetchUser } = useCurrentUser();
    const { token } = useSettingsStore();

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (currentUser) {
            setName(currentUser.name);
            setEmail(currentUser.email);
        }
    }, [currentUser]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/profile`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: name,
                    email: email,
                }),
            });

            if (response.ok) {
                await refetchUser();
                navigation.goBack();
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdatePhoto = () => {
        console.log("Gallery");
    };

    if (!currentUser) {
        return (
            <View style={[styles.container, { justifyContent: 'center' }]}>
                <ActivityIndicator color="#A855F7" size="large" />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ArrowLeft color="white" size={28} />
                    <Text style={styles.backText}>BACK</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>EDIT PROFILE</Text>
                <View style={{ width: 60 }} />
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ flex: 1 }}
            >
                <ScrollView contentContainerStyle={styles.scrollContent}>

                    <View style={styles.photoSection}>
                        <TouchableOpacity onPress={handleUpdatePhoto} style={styles.avatarContainer}>
                            <Image source={require("../assets/logo.png")} style={styles.avatar} />
                            <View style={styles.cameraBadge}>
                                <Camera color="white" size={16} />
                            </View>
                        </TouchableOpacity>
                        <Text style={styles.tagText}>TAG: {currentUser.tag}</Text>
                        <Text style={styles.tagSubtitle}>(Tag-ul este unic și nu poate fi modificat)</Text>
                    </View>

                    <View style={styles.formSection}>
                        <Text style={styles.inputLabel}>DISPLAY NAME</Text>
                        <View style={styles.inputContainer}>
                            <User color="#A855F7" size={20} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                value={name}
                                onChangeText={setName}
                                placeholder="Enter your name"
                                placeholderTextColor="#666"
                                autoCapitalize="words"
                            />
                        </View>

                        <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
                        <View style={styles.inputContainer}>
                            <Mail color="#A855F7" size={20} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                value={email}
                                onChangeText={setEmail}
                                placeholder="Enter your email"
                                placeholderTextColor="#666"
                                keyboardType="email-address"
                                autoCapitalize="none"
                            />
                        </View>
                    </View>

                    <ActionButton
                        title={isSaving ? "SAVING..." : "SAVE CHANGES"}
                        onPress={handleSave}
                        disabled={isSaving || !name.trim() || !email.trim()}
                        style={styles.saveButton}
                    />

                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#000000",
    },

    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 15,
    },

    backButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },

    backText: {
        color: "white",
        fontSize: 16,
        fontWeight: "bold",
    },

    headerTitle: {
        color: "white",
        fontSize: 18,
        fontWeight: "900",
        letterSpacing: 1,
    },

    scrollContent: {
        padding: 20,
        alignItems: "center",
    },

    photoSection: {
        alignItems: "center",
        marginBottom: 40,
        marginTop: 20,
    },

    avatarContainer: {
        position: "relative",
        marginBottom: 15,
    },

    avatar: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 2,
        borderColor: "#A855F7",
        backgroundColor: "#111",
    },

    cameraBadge: {
        position: "absolute",
        bottom: 0,
        right: 5,
        backgroundColor: "#A855F7",
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 3,
        borderColor: "#000",
    },

    tagText: {
        color: "white",
        fontSize: 18,
        fontWeight: "900",
        letterSpacing: 2,
    },

    tagSubtitle: {
        color: "#666",
        fontSize: 12,
        marginTop: 5,
    },

    formSection: {
        width: "100%",
        marginBottom: 30,
    },

    inputLabel: {
        color: "#888",
        fontSize: 12,
        fontWeight: "bold",
        marginBottom: 8,
        marginLeft: 5,
        letterSpacing: 1,
    },

    inputContainer: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#0A0A0A",
        borderWidth: 1,
        borderColor: "#333",
        borderRadius: 12,
        paddingHorizontal: 15,
        marginBottom: 20,
    },

    inputIcon: {
        marginRight: 15,
    },

    input: {
        flex: 1,
        color: "white",
        fontSize: 16,
        paddingVertical: 15,
        fontWeight: "500",
    },

    saveButton: {
        width: "100%",
        marginTop: 10,
        paddingVertical: 15,
    },
});