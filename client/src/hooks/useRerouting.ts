import { useState, useEffect, useCallback } from 'react';

interface Coords {
    latitude: number;
    longitude: number;
}

const getDistanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

export const useRerouting = (
    currentCoords: Coords,
    routeCoordinates: Coords[],
    isNavigating: boolean,
    toleranceMeters: number = 50
) => {
    const [isRerouting, setIsRerouting] = useState(false);
    const [routeOrigin, setRouteOrigin] = useState<Coords | null>(null);

    useEffect(() => {
        if (!isNavigating || routeCoordinates.length === 0 || isRerouting || currentCoords.latitude === 0) {
            return;
        }

        let minDistance = Infinity;

        for (let i = 0; i < routeCoordinates.length; i++) {
            const dist = getDistanceInMeters(
                currentCoords.latitude, currentCoords.longitude,
                routeCoordinates[i].latitude, routeCoordinates[i].longitude
            );
            if (dist < minDistance) {
                minDistance = dist;
            }
        }

        if (minDistance > toleranceMeters) {
            console.log(`[REROUTING] Off-route detectat! Distanța: ${minDistance.toFixed(2)}m.`);
            setIsRerouting(true);
            setRouteOrigin(currentCoords);
        }
    }, [currentCoords, isNavigating, routeCoordinates, isRerouting, toleranceMeters]);

    const finishRerouting = useCallback(() => setIsRerouting(false), []);

    const resetRouteOrigin = useCallback(() => setRouteOrigin(null), []);

    const initRouteOrigin = useCallback((coords: Coords) => setRouteOrigin(coords), []);

    return {
        isRerouting,
        routeOrigin,
        initRouteOrigin,
        finishRerouting,
        resetRouteOrigin
    };
};
