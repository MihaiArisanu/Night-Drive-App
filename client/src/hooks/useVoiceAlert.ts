import { useEffect, useRef } from 'react';
import Tts from 'react-native-tts';

const calculateDistance = (coords1: any, coords2: any) => {
    if (!coords1 || !coords2) return Infinity;

    const toRad = (value: number) => (value * Math.PI) / 180;
    const R = 6371e3;

    const dLat = toRad(coords2.latitude - coords1.latitude);
    const dLon = toRad(coords2.longitude - coords1.longitude);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(coords1.latitude)) * Math.cos(toRad(coords2.latitude)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

export const useVoiceAlerts = (events: any[], userCoords: any) => {
    const spokenEvents = useRef(new Set());

    useEffect(() => {
        if (!userCoords || userCoords.latitude === 0 || !events) return;

        events.forEach(event => {
            const distance = calculateDistance(userCoords, event);

            if (distance < 500 && !spokenEvents.current.has(event.id)) {

                const eventName = event.type === 'police' ? 'Police' :
                    event.type === 'pothole' ? 'Pothole' :
                        'Accident';

                const message = `Caution! ${eventName} reported 500 meters ahead.`;

                Tts.speak(message);
                spokenEvents.current.add(event.id);
            }
        });
    }, [events, userCoords]);
};