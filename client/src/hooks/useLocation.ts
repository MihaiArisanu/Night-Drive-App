import { useState, useEffect } from 'react';
import Geolocation from 'react-native-geolocation-service';

let globalSpeed = 0;
let globalHeading = 0;
let globalCoords = { latitude: 0, longitude: 0 };
let globalAccuracy = 0;

export const useLocation = () => {
    const [speed, setSpeed] = useState(globalSpeed);
    const [heading, setHeading] = useState(globalHeading);
    const [coords, setCoords] = useState(globalCoords);
    const [accuracy, setAccuracy] = useState(globalAccuracy);

    useEffect(() => {
        const watchId = Geolocation.watchPosition(
            (position) => {
                const speedMs = position.coords.speed || 0;
                const speedKmh = speedMs > 0 ? Math.round(speedMs * 3.6) : 0;
                
                globalSpeed = speedKmh;
                globalHeading = position.coords.heading || 0;
                globalCoords = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                };
                globalAccuracy = position.coords.accuracy || 0;

                setSpeed(globalSpeed);
                setHeading(globalHeading);
                setCoords(globalCoords);
                setAccuracy(globalAccuracy);
            },
            () => undefined,
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

    return { speed, heading, coords, accuracy };
};
