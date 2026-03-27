import { useState } from 'react';
import { API_BASE_URL } from '@env';
import { Alert } from 'react-native';

export function useReporting() {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submitReport = async (type: 'police' | 'pothole' | 'accident', latitude: number, longitude: number) => {
        setIsSubmitting(true);

        try {
            const response = await fetch(`${API_BASE_URL}/api/events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: type,
                    latitude: latitude,
                    longitude: longitude,
                }),
            });

            if (!response.ok) {
                throw new Error('Eroare la trimiterea raportului către server.');
            }

            const data = await response.json();
            return { success: true, data };

        } catch (error) {
            console.error("Report submission failed:", error);
            Alert.alert("Eroare de conexiune", "Nu am putut trimite raportul. Verifică conexiunea la internet.");
            return { success: false, error };
        } finally {
            setIsSubmitting(false);
        }
    };

    return { submitReport, isSubmitting };
}