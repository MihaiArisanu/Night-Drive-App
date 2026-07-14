import { useEffect, useMemo, useState } from 'react';

import { ApiError, apiFetch } from '../services/api';

export interface RouteCoordinate {
    latitude: number;
    longitude: number;
}

export interface AvoidanceRoute {
    coordinates: RouteCoordinate[];
    distance: number;
    duration: number;
    usedDetour: boolean;
    avoidanceZones: number;
}

interface UseAvoidanceRouteOptions {
    enabled: boolean;
    origin: RouteCoordinate | null;
    destination: RouteCoordinate | null;
    waypoints?: RouteCoordinate[];
    avoidanceRevision?: string;
}

interface RoutePlanResponse {
    coordinates?: RouteCoordinate[];
    distance?: number;
    duration?: number;
    used_detour?: boolean;
    avoidance_zones?: number;
}

export function useAvoidanceRoute({
    enabled,
    origin,
    destination,
    waypoints = [],
    avoidanceRevision = '',
}: UseAvoidanceRouteOptions) {
    const [route, setRoute] = useState<AvoidanceRoute | null>(null);
    const [error, setError] = useState<ApiError | Error | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const waypointsPayload = useMemo(
        () => JSON.stringify(waypoints.map((waypoint) => ({
            latitude: waypoint.latitude,
            longitude: waypoint.longitude,
        }))),
        [waypoints],
    );
    const originLatitude = origin?.latitude ?? null;
    const originLongitude = origin?.longitude ?? null;
    const destinationLatitude = destination?.latitude ?? null;
    const destinationLongitude = destination?.longitude ?? null;

    useEffect(() => {
        if (
            !enabled
            || originLatitude === null
            || originLongitude === null
            || destinationLatitude === null
            || destinationLongitude === null
        ) {
            setRoute(null);
            setError(null);
            setIsLoading(false);
            return;
        }

        const abortController = new AbortController();
        setRoute(null);
        setError(null);
        setIsLoading(true);

        const loadRoute = async () => {
            try {
                const response: RoutePlanResponse = await apiFetch('/routes/plan', {
                    method: 'POST',
                    signal: abortController.signal,
                    body: JSON.stringify({
                        origin: {
                            latitude: originLatitude,
                            longitude: originLongitude,
                        },
                        destination: {
                            latitude: destinationLatitude,
                            longitude: destinationLongitude,
                        },
                        waypoints: JSON.parse(waypointsPayload),
                    }),
                });
                if (!Array.isArray(response.coordinates) || response.coordinates.length < 2) {
                    throw new Error('Route planner returned an invalid route.');
                }
                setRoute({
                    coordinates: response.coordinates,
                    distance: Number(response.distance) || 0,
                    duration: Number(response.duration) || 0,
                    usedDetour: response.used_detour === true,
                    avoidanceZones: Number(response.avoidance_zones) || 0,
                });
            } catch (routeError) {
                if (abortController.signal.aborted) {
                    return;
                }
                setError(
                    routeError instanceof Error
                        ? routeError
                        : new Error('Route planning failed.'),
                );
            } finally {
                if (!abortController.signal.aborted) {
                    setIsLoading(false);
                }
            }
        };
        loadRoute();

        return () => abortController.abort();
    }, [
        enabled,
        originLatitude,
        originLongitude,
        destinationLatitude,
        destinationLongitude,
        waypointsPayload,
        avoidanceRevision,
    ]);

    return { route, error, isLoading };
}
