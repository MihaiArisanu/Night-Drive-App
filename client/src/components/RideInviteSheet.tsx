import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder, Dimensions, NativeModules, Pressable, Vibration } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { User, MapPin, X } from 'lucide-react-native';

const { width } = Dimensions.get('window');

interface RideInviteSheetProps {
    isVisible: boolean;
    friendName: string;
    distance: string;
    eta: string;
    expiresAt: string;
    onAccept: () => void;
    onDecline: () => void;
}

export function RideInviteSheet({ isVisible, friendName, distance, eta, expiresAt, onAccept, onDecline }: RideInviteSheetProps) {
    const insets = useSafeAreaInsets();
    const pan = useRef(new Animated.ValueXY()).current;
    const acceptRef = useRef(onAccept);
    const declineRef = useRef(onDecline);
    const sliderWidth = width - 50;
    const thumbWidth = 60;
    const contentStyle = useMemo(
        () => [
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 24) + 40 },
        ],
        [insets.bottom],
    );

    useEffect(() => {
        acceptRef.current = onAccept;
        declineRef.current = onDecline;
    }, [onAccept, onDecline]);

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onPanResponderMove: (e, gesture) => {
                if (gesture.dx > 0 && gesture.dx <= sliderWidth - thumbWidth) {
                    pan.setValue({ x: gesture.dx, y: 0 });
                }
            },
            onPanResponderRelease: (e, gesture) => {
                if (gesture.dx > (sliderWidth - thumbWidth) * 0.6) {
                    Animated.spring(pan, {
                        toValue: { x: sliderWidth - thumbWidth, y: 0 },
                        useNativeDriver: false,
                    }).start(() => acceptRef.current());
                } else {
                    Animated.spring(pan, {
                        toValue: { x: 0, y: 0 },
                        useNativeDriver: false,
                    }).start();
                }
            },
        })
    ).current;

    useEffect(() => {
        if (isVisible) {
            pan.setValue({ x: 0, y: 0 });
            NativeModules.RideAlert?.play?.();
            Vibration.vibrate([0, 80, 70, 80]);
            const remainingTime = Math.max(0, Date.parse(expiresAt) - Date.now());
            const timer = setTimeout(() => {
                declineRef.current();
            }, remainingTime);
            return () => clearTimeout(timer);
        } else {
            pan.setValue({ x: 0, y: 0 });
        }
    }, [expiresAt, isVisible, pan]);

    if (!isVisible) return null;

    return (
        <Pressable style={styles.overlay} onPress={() => declineRef.current()}>
            <Pressable style={styles.sheetContainer} onPress={() => declineRef.current()}>
                <View style={contentStyle}>

                <TouchableOpacity style={styles.closeBtn} onPress={onDecline}>
                    <X color="#666" size={24} />
                </TouchableOpacity>

                <View style={styles.header}>
                    <View style={styles.avatar}>
                        <User color="#FFF" size={32} />
                    </View>
                    <View style={styles.info}>
                        <Text style={styles.title}>{friendName} is nearby!</Text>
                        <Text style={styles.subtitle}>Heading your way</Text>
                    </View>
                </View>

                <View style={styles.statsContainer}>
                    <View style={styles.statBox}>
                        <MapPin color="#8A2BE2" size={20} />
                        <Text style={styles.statValue}>{distance}</Text>
                        <Text style={styles.statLabel}>Away</Text>
                    </View>
                    <View style={styles.statBox}>
                        <Text style={styles.statValue}>{eta}</Text>
                        <Text style={styles.statLabel}>ETA to Intersect</Text>
                    </View>
                </View>

                <View style={styles.sliderTrack}>
                    <Text style={styles.sliderText}>SWIPE TO JOIN RIDE</Text>
                    <Animated.View
                        style={[styles.sliderThumb, { transform: [{ translateX: pan.x }] }]}
                        {...panResponder.panHandlers}
                    >
                        <Text style={styles.arrow}>»</Text>
                    </Animated.View>
                </View>

                </View>
            </Pressable>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        justifyContent: 'flex-end',
        zIndex: 100,
        elevation: 20,
    },
    sheetContainer: {
        width: '100%',
        height: '48%',
        backgroundColor: '#0a0a0a',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        borderTopWidth: 1,
        borderTopColor: '#333',
        shadowColor: '#8A2BE2',
        shadowOffset: { width: 0, height: -5 },
        shadowOpacity: 0.3,
        shadowRadius: 15,
    },
    content: {
        padding: 25,
        flex: 1,
        justifyContent: 'space-between',
    },
    closeBtn: {
        position: 'absolute',
        top: 20,
        right: 20,
        zIndex: 10,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    avatar: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#1A1A1A',
        borderWidth: 2,
        borderColor: '#8A2BE2',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 15,
    },
    info: {
        flex: 1,
        justifyContent: 'center',
    },
    title: {
        color: 'white',
        fontSize: 22,
        fontWeight: 'bold',
    },
    subtitle: {
        color: '#888',
        fontSize: 14,
        marginTop: 2,
    },
    statsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: '#111',
        borderRadius: 15,
        padding: 15,
        marginBottom: 25,
        borderWidth: 1,
        borderColor: '#222',
    },
    statBox: {
        alignItems: 'center',
    },
    statValue: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
        marginVertical: 5,
    },
    statLabel: {
        color: '#666',
        fontSize: 12,
    },
    sliderTrack: {
        height: 60,
        backgroundColor: '#1A1A1A',
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#333',
        overflow: 'hidden',
    },
    sliderText: {
        color: '#555',
        fontWeight: 'bold',
        letterSpacing: 2,
        position: 'absolute',
    },
    sliderThumb: {
        position: 'absolute',
        left: 0,
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#8A2BE2',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#8A2BE2',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 10,
    },
    arrow: {
        color: 'white',
        fontSize: 24,
        fontWeight: 'bold',
    },
});
