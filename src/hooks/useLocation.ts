import { useState, useEffect } from 'react';
import Geolocation from 'react-native-geolocation-service';

export const useLocation = () => {
    const [speed, setSpeed] = useState(0);
    const [heading, setHeading] = useState(0);
    const [coords, setCoords] = useState({ latitude: 0, longitude: 0 });

    useEffect(() => {
        const watchId = Geolocation.watchPosition(
            (position) => {
                const speedMs = position.coords.speed || 0;
                const speedKmh = speedMs > 0 ? Math.round(speedMs * 3.6) : 0;
                setSpeed(speedKmh);

                setHeading(position.coords.heading || 0);
                setCoords({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                });
            },
            (error) => {
                console.log("Eroare GPS la citire viteză:", error.code, error.message);
            },
            {
                enableHighAccuracy: true,
                distanceFilter: 2,
                interval: 1000,
                fastestInterval: 500
            }
        );

        return () => {
            Geolocation.clearWatch(watchId);
        };
    }, []);

    return { speed, heading, coords };
};