import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    PanResponder,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import MapView, {
    Polygon,
    PROVIDER_GOOGLE,
} from 'react-native-maps';
import Svg, { Polyline as SvgPolyline } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RotateCcw, X } from 'lucide-react-native';

type Coordinate = { latitude: number; longitude: number };
type ScreenPoint = { x: number; y: number };
type DrawingStage = 'positioning' | 'drawing' | 'preview';

interface DrawAvoidanceZoneModalProps {
    visible: boolean;
    userCoordinate: Coordinate | null;
    onClose: () => void;
    onSave: (polygon: Coordinate[], name: string) => Promise<boolean>;
}

interface DrawingSurfaceProps {
    onComplete: (points: ScreenPoint[]) => void;
}

const FALLBACK_COORDINATE = { latitude: 44.4268, longitude: 26.1025 };
const MINIMUM_AREA_SQUARE_METERS = 50;
const MAXIMUM_AREA_SQUARE_METERS = 5_000_000;
const MAXIMUM_POLYGON_POINTS = 64;

function DrawingSurface({ onComplete }: DrawingSurfaceProps) {
    const pointsRef = useRef<ScreenPoint[]>([]);
    const [points, setPoints] = useState<ScreenPoint[]>([]);

    const panResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => {
            const point = {
                x: event.nativeEvent.locationX,
                y: event.nativeEvent.locationY,
            };
            pointsRef.current = [point];
            setPoints([point]);
        },
        onPanResponderMove: event => {
            const point = {
                x: event.nativeEvent.locationX,
                y: event.nativeEvent.locationY,
            };
            const last = pointsRef.current[pointsRef.current.length - 1];
            if (last && Math.hypot(point.x - last.x, point.y - last.y) < 3) {
                return;
            }
            pointsRef.current = [...pointsRef.current, point];
            setPoints(pointsRef.current);
        },
        onPanResponderRelease: () => {
            const completed = pointsRef.current;
            pointsRef.current = [];
            setPoints([]);
            onComplete(completed);
        },
        onPanResponderTerminate: () => {
            pointsRef.current = [];
            setPoints([]);
        },
    }), [onComplete]);

    const svgPoints = points.map(point => `${point.x},${point.y}`).join(' ');

    return (
        <View style={styles.drawingSurface} {...panResponder.panHandlers}>
            <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
                <SvgPolyline
                    points={svgPoints}
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </Svg>
        </View>
    );
}

export function DrawAvoidanceZoneModal({
    visible,
    userCoordinate,
    onClose,
    onSave,
}: DrawAvoidanceZoneModalProps) {
    const mapRef = useRef<MapView>(null);
    const [stage, setStage] = useState<DrawingStage>('positioning');
    const [polygon, setPolygon] = useState<Coordinate[]>([]);
    const [name, setName] = useState('Custom avoided zone');
    const [isConverting, setIsConverting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const center = useMemo(
        () => userCoordinate?.latitude ? userCoordinate : FALLBACK_COORDINATE,
        [userCoordinate],
    );
    const latestCenter = useRef(center);

    useEffect(() => {
        latestCenter.current = center;
    }, [center]);

    useEffect(() => {
        if (!visible) return;
        setStage('positioning');
        setPolygon([]);
        setName('Custom avoided zone');
        setIsConverting(false);
        setIsSaving(false);
        const timer = setTimeout(() => {
            mapRef.current?.animateToRegion({
                ...latestCenter.current,
                latitudeDelta: 0.012,
                longitudeDelta: 0.012,
            }, 350);
        }, 250);
        return () => clearTimeout(timer);
    }, [visible]);

    const handleStrokeComplete = async (screenPoints: ScreenPoint[]) => {
        if (!mapRef.current || screenPoints.length < 8) {
            Alert.alert('Draw a larger zone', 'Use one continuous gesture to circle the area.');
            return;
        }

        setIsConverting(true);
        try {
            let simplified = simplifyScreenPath(screenPoints, 4);
            let tolerance = 5;
            while (simplified.length > MAXIMUM_POLYGON_POINTS) {
                simplified = simplifyScreenPath(screenPoints, tolerance);
                tolerance *= 1.35;
            }
            if (simplified.length < 3) {
                throw new Error('The drawn shape is too small.');
            }

            const coordinates = await Promise.all(
                simplified.map(point => mapRef.current!.coordinateForPoint(point)),
            );
            if (polygonSelfIntersects(coordinates)) {
                throw new Error('The contour crosses itself. Draw one simple closed shape.');
            }

            const area = polygonAreaSquareMeters(coordinates);
            if (area < MINIMUM_AREA_SQUARE_METERS) {
                throw new Error('The zone is too small. Circle a slightly larger area.');
            }
            if (area > MAXIMUM_AREA_SQUARE_METERS) {
                throw new Error('The zone is too large. Keep it below 5 km².');
            }

            setPolygon(coordinates);
            setStage('preview');
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'The zone could not be read. Please draw it again.';
            Alert.alert('Invalid zone', message);
            setStage('positioning');
        } finally {
            setIsConverting(false);
        }
    };

    const handleSave = async () => {
        const trimmedName = name.trim();
        if (polygon.length < 3 || !trimmedName || isSaving) return;

        setIsSaving(true);
        const saved = await onSave(polygon, trimmedName);
        setIsSaving(false);
        if (saved) {
            onClose();
            return;
        }
        Alert.alert('Could not save zone', 'Please check your connection and try again.');
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <MapView
                    ref={mapRef}
                    provider={PROVIDER_GOOGLE}
                    style={StyleSheet.absoluteFill}
                    initialRegion={{
                        ...center,
                        latitudeDelta: 0.012,
                        longitudeDelta: 0.012,
                    }}
                    showsUserLocation
                    showsMyLocationButton
                    toolbarEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    scrollEnabled={stage !== 'drawing'}
                    zoomEnabled={stage !== 'drawing'}
                >
                    {polygon.length >= 3 && (
                        <Polygon
                            coordinates={polygon}
                            strokeColor="#EF4444"
                            fillColor="rgba(239, 68, 68, 0.28)"
                            strokeWidth={4}
                        />
                    )}
                </MapView>

                {stage === 'drawing' && (
                    <DrawingSurface onComplete={handleStrokeComplete} />
                )}

                <SafeAreaView style={styles.header} edges={['top']}>
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <X color="#FFF" size={26} />
                    </TouchableOpacity>
                    <View style={styles.headerText}>
                        <Text style={styles.title}>DRAW AVOIDANCE ZONE</Text>
                        <Text style={styles.subtitle}>
                            {stage === 'positioning'
                                ? 'Move and zoom the map, then start drawing.'
                                : stage === 'drawing'
                                    ? 'Circle the area with one continuous gesture.'
                                    : 'Confirm the red area before saving.'}
                        </Text>
                    </View>
                    <View style={styles.headerSpacer} />
                </SafeAreaView>

                {isConverting && (
                    <View style={styles.processingOverlay}>
                        <ActivityIndicator color="#EF4444" size="large" />
                        <Text style={styles.processingText}>Reading zone…</Text>
                    </View>
                )}

                <SafeAreaView style={styles.bottomPanel} edges={['bottom']}>
                    {stage === 'positioning' && (
                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => {
                                setPolygon([]);
                                setStage('drawing');
                            }}
                        >
                            <Text style={styles.primaryButtonText}>Start Drawing</Text>
                        </TouchableOpacity>
                    )}

                    {stage === 'drawing' && (
                        <View style={styles.drawingHint}>
                            <Text style={styles.drawingHintText}>
                                Lift your finger when the contour is complete
                            </Text>
                            <TouchableOpacity onPress={() => setStage('positioning')}>
                                <Text style={styles.cancelDrawingText}>Cancel drawing</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {stage === 'preview' && (
                        <>
                            <TextInput
                                value={name}
                                onChangeText={setName}
                                placeholder="Zone name"
                                placeholderTextColor="#71717A"
                                maxLength={255}
                                style={styles.nameInput}
                            />
                            <View style={styles.previewActions}>
                                <TouchableOpacity
                                    style={styles.secondaryButton}
                                    onPress={() => {
                                        setPolygon([]);
                                        setStage('positioning');
                                    }}
                                >
                                    <RotateCcw color="#FFF" size={20} />
                                    <Text style={styles.secondaryButtonText}>Redraw</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.saveButton,
                                        (!name.trim() || isSaving) && styles.disabledButton,
                                    ]}
                                    onPress={handleSave}
                                    disabled={!name.trim() || isSaving}
                                >
                                    {isSaving
                                        ? <ActivityIndicator color="#FFF" />
                                        : <Text style={styles.primaryButtonText}>Save Zone</Text>}
                                </TouchableOpacity>
                            </View>
                        </>
                    )}
                </SafeAreaView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

function simplifyScreenPath(points: ScreenPoint[], tolerance: number): ScreenPoint[] {
    if (points.length <= 2) return points;

    let maximumDistance = 0;
    let splitIndex = 0;
    const start = points[0];
    const end = points[points.length - 1];
    for (let index = 1; index < points.length - 1; index++) {
        const distance = perpendicularScreenDistance(points[index], start, end);
        if (distance > maximumDistance) {
            maximumDistance = distance;
            splitIndex = index;
        }
    }
    if (maximumDistance <= tolerance) {
        return [start, end];
    }

    const left = simplifyScreenPath(points.slice(0, splitIndex + 1), tolerance);
    const right = simplifyScreenPath(points.slice(splitIndex), tolerance);
    return [...left.slice(0, -1), ...right];
}

function perpendicularScreenDistance(
    point: ScreenPoint,
    start: ScreenPoint,
    end: ScreenPoint,
) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    if (deltaX === 0 && deltaY === 0) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }
    const projection = Math.max(0, Math.min(
        1,
        ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY)
            / (deltaX * deltaX + deltaY * deltaY),
    ));
    return Math.hypot(
        point.x - (start.x + projection * deltaX),
        point.y - (start.y + projection * deltaY),
    );
}

function polygonAreaSquareMeters(polygon: Coordinate[]) {
    const origin = polygon.reduce(
        (result, point) => ({
            latitude: result.latitude + point.latitude / polygon.length,
            longitude: result.longitude + point.longitude / polygon.length,
        }),
        { latitude: 0, longitude: 0 },
    );
    const latitudeRadians = origin.latitude * Math.PI / 180;
    const earthRadius = 6_371_000;
    const projected = polygon.map(point => ({
        x: (point.longitude - origin.longitude) * Math.PI / 180
            * earthRadius * Math.cos(latitudeRadians),
        y: (point.latitude - origin.latitude) * Math.PI / 180 * earthRadius,
    }));
    let twiceArea = 0;
    for (let index = 0; index < projected.length; index++) {
        const next = (index + 1) % projected.length;
        twiceArea += projected[index].x * projected[next].y
            - projected[next].x * projected[index].y;
    }
    return Math.abs(twiceArea) / 2;
}

function polygonSelfIntersects(polygon: Coordinate[]) {
    for (let first = 0; first < polygon.length; first++) {
        const firstNext = (first + 1) % polygon.length;
        for (let second = first + 1; second < polygon.length; second++) {
            const secondNext = (second + 1) % polygon.length;
            if (
                first === second
                || firstNext === second
                || secondNext === first
            ) {
                continue;
            }
            if (segmentsIntersect(
                polygon[first],
                polygon[firstNext],
                polygon[second],
                polygon[secondNext],
            )) {
                return true;
            }
        }
    }
    return false;
}

function segmentsIntersect(
    firstStart: Coordinate,
    firstEnd: Coordinate,
    secondStart: Coordinate,
    secondEnd: Coordinate,
) {
    const orientation = (first: Coordinate, second: Coordinate, third: Coordinate) =>
        (second.longitude - first.longitude) * (third.latitude - first.latitude)
        - (second.latitude - first.latitude) * (third.longitude - first.longitude);
    const firstOrientation = orientation(firstStart, firstEnd, secondStart);
    const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
    const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
    const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);
    return firstOrientation * secondOrientation < 0
        && thirdOrientation * fourthOrientation < 0;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    drawingSurface: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 5,
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 8,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.86)',
    },
    closeButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#18181B',
    },
    headerText: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 10,
    },
    headerSpacer: {
        width: 44,
    },
    title: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '900',
        letterSpacing: 0.8,
    },
    subtitle: {
        color: '#A1A1AA',
        fontSize: 12,
        marginTop: 3,
        textAlign: 'center',
    },
    bottomPanel: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9,
        paddingHorizontal: 18,
        paddingTop: 14,
        backgroundColor: 'rgba(9, 9, 11, 0.94)',
        borderTopWidth: 1,
        borderTopColor: '#27272A',
    },
    primaryButton: {
        minHeight: 54,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EF4444',
        marginBottom: 12,
    },
    primaryButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '900',
    },
    drawingHint: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    drawingHintText: {
        color: '#FFF',
        fontSize: 14,
        fontWeight: '700',
    },
    cancelDrawingText: {
        color: '#FCA5A5',
        marginTop: 10,
        marginBottom: 6,
        fontWeight: '700',
    },
    nameInput: {
        height: 50,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#3F3F46',
        backgroundColor: '#18181B',
        color: '#FFF',
        paddingHorizontal: 16,
        fontSize: 15,
        marginBottom: 12,
    },
    previewActions: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 10,
    },
    secondaryButton: {
        flex: 1,
        minHeight: 52,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: '#3F3F46',
        backgroundColor: '#18181B',
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryButtonText: {
        color: '#FFF',
        fontWeight: '800',
    },
    saveButton: {
        flex: 1.4,
        minHeight: 52,
        borderRadius: 15,
        backgroundColor: '#EF4444',
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabledButton: {
        opacity: 0.45,
    },
    processingOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    processingText: {
        color: '#FFF',
        fontWeight: '800',
        marginTop: 12,
    },
});
