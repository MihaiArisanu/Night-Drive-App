import { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { apiFetch, AuthStorage } from '../services/api';

export const useDeleteAccount = () => {
    const [isDeleting, setIsDeleting] = useState(false);
    const navigation = useNavigation<any>();

    const confirmAndDelete = () => {
        Alert.alert(
            "DANGER ZONE: Delete Account",
            "Are you sure? This permanently deletes your profile, friends, routes, location history, avatar, and active sessions.",
            [
                {
                    text: "Cancel",
                    style: "cancel"
                },
                {
                    text: "Delete Forever",
                    style: "destructive",
                    onPress: async () => {
                        setIsDeleting(true);
                        try {
                            await apiFetch('/users/me', { method: 'DELETE' });

                            await AuthStorage.clearTokens();

                            navigation.reset({
                                index: 0,
                                routes: [{ name: 'Auth' }],
                            });
                        } catch (error: unknown) {
                            const message = error instanceof Error
                                ? error.message
                                : "Could not delete your account. Try again later.";
                            Alert.alert("Error", message);
                        } finally {
                            setIsDeleting(false);
                        }
                    }
                }
            ]
        );
    };

    return { confirmAndDelete, isDeleting };
};
