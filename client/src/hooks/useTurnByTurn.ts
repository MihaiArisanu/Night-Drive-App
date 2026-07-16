import { useEffect, useMemo, useState } from 'react';
import { RouteCoordinate, RouteStep } from './useAvoidanceRoute';

const EARTH_RADIUS_METERS = 6371000;
const STEP_COMPLETION_TOLERANCE_METERS = 35;

export interface PolylineProgress {
    distanceFromRoute: number;
    remainingDistance: number;
}

export interface TurnInstruction {
    instruction: string;
    maneuver: string;
    distanceMeters: number;
}

export function useTurnByTurn(
    steps: RouteStep[],
    currentLocation: RouteCoordinate,
    enabled: boolean,
    arrivalLabel = 'your destination',
): TurnInstruction | null {
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const routeRevision = useMemo(
        () => steps.map((step) => [
            step.start.latitude.toFixed(5),
            step.start.longitude.toFixed(5),
            step.end.latitude.toFixed(5),
            step.end.longitude.toFixed(5),
            step.maneuver,
        ].join(':')).join('|'),
        [steps],
    );

    useEffect(() => {
        setActiveStepIndex(0);
    }, [routeRevision]);

    useEffect(() => {
        if (!enabled || steps.length === 0 || currentLocation.latitude === 0) return;
        const currentIndex = Math.min(activeStepIndex, steps.length - 1);
        const currentProgress = projectOnPolyline(currentLocation, steps[currentIndex].coordinates);
        if (!currentProgress || currentIndex >= steps.length - 1) return;

        const nextProgress = projectOnPolyline(currentLocation, steps[currentIndex + 1].coordinates);
        const enteredNextStep = nextProgress
            && currentProgress.remainingDistance <= 160
            && nextProgress.distanceFromRoute + 12 < currentProgress.distanceFromRoute;
        if (
            currentProgress.remainingDistance <= STEP_COMPLETION_TOLERANCE_METERS
            || enteredNextStep
        ) {
            setActiveStepIndex(currentIndex + 1);
        }
    }, [activeStepIndex, currentLocation, enabled, steps]);

    if (!enabled || steps.length === 0) return null;
    const currentIndex = Math.min(activeStepIndex, steps.length - 1);
    const progress = projectOnPolyline(currentLocation, steps[currentIndex].coordinates);
    const remainingMeters = Math.max(0, Math.round(progress?.remainingDistance ?? steps[currentIndex].distanceMeters));

    if (currentIndex < steps.length - 1) {
        const upcomingStep = steps[currentIndex + 1];
        return {
            instruction: upcomingStep.instruction,
            maneuver: upcomingStep.maneuver,
            distanceMeters: remainingMeters,
        };
    }
    return {
        instruction: remainingMeters <= 50 ? `Arrive at ${arrivalLabel}` : `Continue to ${arrivalLabel}`,
        maneuver: 'straight',
        distanceMeters: remainingMeters,
    };
}

export function maneuverSymbol(maneuver: string) {
    const normalized = maneuver.toLowerCase();
    if (normalized.includes('uturn-left')) return '↶';
    if (normalized.includes('uturn-right')) return '↷';
    if (normalized.includes('roundabout')) return '↻';
    if (normalized.includes('left')) return '↰';
    if (normalized.includes('right')) return '↱';
    if (normalized.includes('merge') || normalized.includes('ramp')) return '↗';
    return '↑';
}

export function projectOnPolyline(
    point: RouteCoordinate,
    coordinates: RouteCoordinate[],
): PolylineProgress | null {
    if (coordinates.length < 2) return null;

    const segmentLengths = coordinates.slice(0, -1).map((coordinate, index) => (
        distanceMeters(coordinate, coordinates[index + 1])
    ));
    const totalDistance = segmentLengths.reduce((sum, distance) => sum + distance, 0);
    let distanceBeforeSegment = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestDistanceAlong = 0;

    for (let index = 0; index < coordinates.length - 1; index += 1) {
        const start = coordinates[index];
        const end = coordinates[index + 1];
        const meanLatitude = ((start.latitude + end.latitude + point.latitude) / 3) * Math.PI / 180;
        const longitudeScale = EARTH_RADIUS_METERS * Math.cos(meanLatitude) * Math.PI / 180;
        const latitudeScale = EARTH_RADIUS_METERS * Math.PI / 180;
        const segmentX = (end.longitude - start.longitude) * longitudeScale;
        const segmentY = (end.latitude - start.latitude) * latitudeScale;
        const pointX = (point.longitude - start.longitude) * longitudeScale;
        const pointY = (point.latitude - start.latitude) * latitudeScale;
        const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
        if (segmentLengthSquared === 0) continue;

        const rawFraction = (pointX * segmentX + pointY * segmentY) / segmentLengthSquared;
        const fraction = Math.max(0, Math.min(1, rawFraction));
        const projectedX = fraction * segmentX;
        const projectedY = fraction * segmentY;
        const distanceFromRoute = Math.hypot(pointX - projectedX, pointY - projectedY);
        if (distanceFromRoute < bestDistance) {
            bestDistance = distanceFromRoute;
            bestDistanceAlong = distanceBeforeSegment + fraction * segmentLengths[index];
        }
        distanceBeforeSegment += segmentLengths[index];
    }

    if (!Number.isFinite(bestDistance)) return null;
    return {
        distanceFromRoute: bestDistance,
        remainingDistance: Math.max(0, totalDistance - bestDistanceAlong),
    };
}

function distanceMeters(first: RouteCoordinate, second: RouteCoordinate) {
    const latitudeDelta = (second.latitude - first.latitude) * Math.PI / 180;
    const longitudeDelta = (second.longitude - first.longitude) * Math.PI / 180;
    const firstLatitude = first.latitude * Math.PI / 180;
    const secondLatitude = second.latitude * Math.PI / 180;
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
