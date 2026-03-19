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
            "Are you sure? This action is permanent. All your routes, friends, and points will be erased.",
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

                            await AuthStorage.removeToken();

                            navigation.reset({
                                index: 0,
                                routes: [{ name: 'Auth' }],
                            });
                        } catch (error) {
                            console.error("Eroare la ștergerea contului:", error);
                            Alert.alert("Error", "Could not delete your account. Try again later.");
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