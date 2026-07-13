import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Modal, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Camera, Image as ImageIcon, Mail, User, X, Lock } from "lucide-react-native";
import { ActionButton } from "../components/ActionButton";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettingsStore } from '../store/useSettingsStore';
import { API_BASE_URL } from '@env';

import { launchCamera, launchImageLibrary, MediaType } from 'react-native-image-picker';

interface SelectedPhoto {
    uri: string;
    fileName?: string;
    type?: string;
}

export default function EditProfileScreen({ navigation }: any) {
    const { currentUser, refetchUser } = useCurrentUser();
    const { token } = useSettingsStore();

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const [isPhotoModalVisible, setIsPhotoModalVisible] = useState(false);
    const [selectedPhoto, setSelectedPhoto] = useState<SelectedPhoto | null>(null);

    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [isPasswordFormVisible, setIsPasswordFormVisible] = useState(false);
    const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const newPasswordLength = Array.from(newPassword).length;
    const isPasswordLongEnough = newPasswordLength >= 8;
    const doPasswordsMatch = newPassword === confirmPassword;

    const resetPasswordForm = () => {
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordFeedback(null);
    };

    const togglePasswordForm = () => {
        if (isPasswordFormVisible) {
            resetPasswordForm();
        }
        setIsPasswordFormVisible((visible) => !visible);
    };

    const handleChangePassword = async () => {
        if (!oldPassword || !newPassword || !confirmPassword) {
            setPasswordFeedback({ type: 'error', text: 'Complete all password fields.' });
            return;
        }
        if (!isPasswordLongEnough) {
            setPasswordFeedback({ type: 'error', text: 'The new password must contain at least 8 characters.' });
            return;
        }
        if (!doPasswordsMatch) {
            setPasswordFeedback({ type: 'error', text: 'The new passwords do not match.' });
            return;
        }
        setIsChangingPassword(true);
        setPasswordFeedback(null);
        try {
            const response = await fetch(`${API_BASE_URL}/users/password`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
            });

            if (!response.ok) {
                const text = await response.text();
                let errMsg = "Failed to change password.";
                try {
                    const parsed = JSON.parse(text);
                    if (parsed.message) errMsg = parsed.message;
                } catch {}
                throw new Error(errMsg);
            }

            setPasswordFeedback({ type: 'success', text: 'Password successfully changed!' });
            setOldPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setTimeout(() => setPasswordFeedback(null), 3000);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error changing password.';
            setPasswordFeedback({ type: 'error', text: message });
        } finally {
            setIsChangingPassword(false);
        }
    };

    useEffect(() => {
        if (currentUser) {
            setName(currentUser.name);
            setEmail(currentUser.email);
        }
    }, [currentUser]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const profileResponse = await fetch(`${API_BASE_URL}/users/profile`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, email }),
            });

            if (!profileResponse.ok) {
                const responseText = await profileResponse.text();
                throw new Error(responseText || 'Could not update profile details.');
            }

            if (selectedPhoto) {
                const formData = new FormData();

                formData.append('avatar', {
                    uri: selectedPhoto.uri,
                    name: selectedPhoto.fileName || 'profile-image.jpg',
                    type: selectedPhoto.type || 'image/jpeg',
                } as any);

                const uploadResponse = await fetch(`${API_BASE_URL}/users/avatar`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData,
                });

                if (!uploadResponse.ok) {
                    const errText = await uploadResponse.text();
                    throw new Error(errText || 'Could not upload profile picture.');
                }
            }

            await refetchUser();
            navigation.goBack();

        } catch (error: unknown) {
            console.error("Eroare la salvare:", error);
            Alert.alert(
                'Could not save profile',
                error instanceof Error ? error.message : 'Please try again.',
            );
        } finally {
            setIsSaving(false);
        }
    };

    const handleOpenCamera = async () => {
        setIsPhotoModalVisible(false);
        const result = await launchCamera({
            mediaType: 'photo' as MediaType,
            quality: 0.8,
            maxWidth: 800,
            maxHeight: 800,
        });

        if (!result.didCancel && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];
            if (asset.uri) {
                setSelectedPhoto({ uri: asset.uri, fileName: asset.fileName, type: asset.type });
            }
        }
    };

    const handleOpenGallery = async () => {
        setIsPhotoModalVisible(false);
        const result = await launchImageLibrary({
            mediaType: 'photo' as MediaType,
            quality: 0.8,
            maxWidth: 800,
            maxHeight: 800,
        });

        if (!result.didCancel && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];
            if (asset.uri) {
                setSelectedPhoto({ uri: asset.uri, fileName: asset.fileName, type: asset.type });
            }
        }
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
                        <TouchableOpacity onPress={() => setIsPhotoModalVisible(true)} style={styles.avatarContainer} activeOpacity={0.7}>
                            <ProfileAvatar
                                profilePictureUrl={currentUser.profile_picture_url}
                                localUri={selectedPhoto?.uri}
                                size={110}
                                style={styles.avatar}
                            />
                            <View style={styles.cameraBadge}>
                                <Camera color="white" size={16} />
                            </View>
                        </TouchableOpacity>
                        <Text style={styles.tagText}>TAG: #{currentUser.tag}</Text>
                        <Text style={styles.tagSubtitle}>(The tag cannot be changed!)</Text>
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

                    <View style={styles.passwordSection}>
                        <TouchableOpacity
                            style={styles.toggleButton}
                            onPress={togglePasswordForm}
                            activeOpacity={0.8}
                        >
                            <Lock color="#A855F7" size={19} />
                            <Text style={styles.toggleButtonText}>
                                {isPasswordFormVisible ? "CANCEL PASSWORD CHANGE" : "CHANGE PASSWORD"}
                            </Text>
                        </TouchableOpacity>

                        {isPasswordFormVisible && (
                            <View style={styles.passwordFormContainer}>
                                <Text style={styles.passwordDescription}>
                                    Choose a new password containing at least 8 characters.
                                </Text>

                                <Text style={styles.inputLabel}>OLD PASSWORD</Text>
                                <View style={styles.inputContainer}>
                                    <Lock color="#A855F7" size={20} style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input}
                                        value={oldPassword}
                                        onChangeText={setOldPassword}
                                        placeholder="Enter old password"
                                        placeholderTextColor="#666"
                                        secureTextEntry
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        textContentType="password"
                                    />
                                </View>

                                <Text style={styles.inputLabel}>NEW PASSWORD</Text>
                                <View style={styles.inputContainer}>
                                    <Lock color="#A855F7" size={20} style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input}
                                        value={newPassword}
                                        onChangeText={setNewPassword}
                                        placeholder="Enter new password"
                                        placeholderTextColor="#666"
                                        secureTextEntry
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        textContentType="newPassword"
                                        maxLength={72}
                                    />
                                </View>

                                <Text style={styles.inputLabel}>CONFIRM NEW PASSWORD</Text>
                                <View style={styles.inputContainer}>
                                    <Lock color="#A855F7" size={20} style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input}
                                        value={confirmPassword}
                                        onChangeText={setConfirmPassword}
                                        placeholder="Repeat new password"
                                        placeholderTextColor="#666"
                                        secureTextEntry
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        textContentType="newPassword"
                                        maxLength={72}
                                    />
                                </View>

                                <View style={styles.passwordRules}>
                                    <Text style={[
                                        styles.passwordRuleText,
                                        newPassword.length > 0 && (isPasswordLongEnough ? styles.ruleValid : styles.ruleInvalid),
                                    ]}>
                                        {isPasswordLongEnough ? '✓' : '•'} At least 8 characters
                                    </Text>
                                    {confirmPassword.length > 0 && (
                                        <Text style={[
                                            styles.passwordRuleText,
                                            doPasswordsMatch ? styles.ruleValid : styles.ruleInvalid,
                                        ]}>
                                            {doPasswordsMatch ? '✓ Passwords match' : '• Passwords do not match'}
                                        </Text>
                                    )}
                                </View>

                                {passwordFeedback && (
                                    <Text style={[
                                        styles.feedbackText,
                                        passwordFeedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError,
                                    ]}>
                                        {passwordFeedback.text}
                                    </Text>
                                )}

                                <ActionButton
                                    title={isChangingPassword ? "CHANGING..." : "UPDATE PASSWORD"}
                                    onPress={handleChangePassword}
                                    disabled={
                                        isChangingPassword ||
                                        !oldPassword ||
                                        !newPassword ||
                                        !confirmPassword ||
                                        !isPasswordLongEnough ||
                                        !doPasswordsMatch
                                    }
                                    style={styles.passwordUpdateButton}
                                />
                            </View>
                        )}
                    </View>

                    <ActionButton
                        title={isSaving ? "SAVING..." : "SAVE CHANGES"}
                        onPress={handleSave}
                        disabled={isSaving || !name.trim() || !email.trim()}
                        style={styles.saveButton}
                    />

                </ScrollView>
            </KeyboardAvoidingView>

            <Modal
                visible={isPhotoModalVisible}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setIsPhotoModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>UPDATE PHOTO</Text>
                            <TouchableOpacity onPress={() => setIsPhotoModalVisible(false)}>
                                <X color="#444" size={24} />
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={styles.photoOptionBtn} onPress={handleOpenCamera}>
                            <Camera color="#A855F7" size={24} />
                            <Text style={styles.photoOptionText}>Take a Photo</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.photoOptionBtn} onPress={handleOpenGallery}>
                            <ImageIcon color="#10B981" size={24} />
                            <Text style={styles.photoOptionText}>Choose from Gallery</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#000000" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 15 },
    backButton: { flexDirection: "row", alignItems: "center", gap: 8 },
    backText: { color: "white", fontSize: 16, fontWeight: "bold" },
    headerTitle: { color: "white", fontSize: 18, fontWeight: "900", letterSpacing: 1 },
    scrollContent: { padding: 20, alignItems: "center" },
    photoSection: { alignItems: "center", marginBottom: 40, marginTop: 20 },
    avatarContainer: { position: "relative", marginBottom: 15 },
    avatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: "#A855F7", backgroundColor: "#111" },
    cameraBadge: { position: "absolute", bottom: 0, right: 5, backgroundColor: "#A855F7", width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center", borderWidth: 3, borderColor: "#000" },
    tagText: { color: "white", fontSize: 18, fontWeight: "900", letterSpacing: 2 },
    tagSubtitle: { color: "#666", fontSize: 12, marginTop: 5 },
    formSection: { width: "100%", marginBottom: 30 },
    inputLabel: { color: "#888", fontSize: 12, fontWeight: "bold", marginBottom: 8, marginLeft: 5, letterSpacing: 1 },
    inputContainer: { flexDirection: "row", alignItems: "center", backgroundColor: "#0A0A0A", borderWidth: 1, borderColor: "#333", borderRadius: 12, paddingHorizontal: 15, marginBottom: 20 },
    inputIcon: { marginRight: 15 },
    input: { flex: 1, color: "white", fontSize: 16, paddingVertical: 15, fontWeight: "500" },
    saveButton: { width: "100%", marginTop: 10, paddingVertical: 15 },
    passwordSection: { width: "100%", marginBottom: 20 },
    passwordFormContainer: { marginTop: 12, backgroundColor: "#080808", borderRadius: 14, borderWidth: 1, borderColor: "#242424", padding: 16 },
    passwordDescription: { color: "#888", fontSize: 13, lineHeight: 19, marginBottom: 20 },
    toggleButton: { flexDirection: "row", justifyContent: "center", gap: 10, backgroundColor: "#0A0A0A", paddingVertical: 15, borderRadius: 12, borderWidth: 1, borderColor: "#A855F7", alignItems: "center" },
    toggleButtonText: { color: "white", fontSize: 14, fontWeight: "bold", letterSpacing: 1 },
    sectionTitle: { color: "white", fontSize: 18, fontWeight: "900", letterSpacing: 1, marginBottom: 20, textAlign: "center" },
    feedbackText: { textAlign: "center", fontSize: 14, fontWeight: "bold", marginBottom: 15 },
    feedbackSuccess: { color: "#10B981" },
    feedbackError: { color: "#EF4444" },
    passwordRules: { marginTop: -5, marginBottom: 18, gap: 5 },
    passwordRuleText: { color: "#71717A", fontSize: 12, fontWeight: "600" },
    ruleValid: { color: "#10B981" },
    ruleInvalid: { color: "#EF4444" },
    passwordUpdateButton: { width: "100%", marginTop: 5, paddingVertical: 15 },

    modalOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.7)", justifyContent: "flex-end" },
    modalContent: { backgroundColor: "#111", borderTopLeftRadius: 25, borderTopRightRadius: 25, padding: 25, paddingBottom: 40, borderWidth: 1, borderColor: "#333" },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
    modalTitle: { color: "white", fontSize: 18, fontWeight: "900", letterSpacing: 1 },
    photoOptionBtn: { flexDirection: "row", alignItems: "center", backgroundColor: "#0A0A0A", padding: 18, borderRadius: 15, marginBottom: 15, borderWidth: 1, borderColor: "#222", gap: 15 },
    photoOptionText: { color: "white", fontSize: 16, fontWeight: "bold" }
});
