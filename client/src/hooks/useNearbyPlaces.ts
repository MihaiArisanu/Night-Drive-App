import { useState, useEffect } from 'react';
import { GOOGLE_API_GENERAL_KEY } from '@env';

export interface PlaceResult {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    address: string;
    isSponsored?: boolean;
    hasHydrogen?: boolean;
}

type SearchType = 'none' | 'gas' | 'ev' | 'gas_ev' | 'saved';

export function useNearbyPlaces(
    latitude: number,
    longitude: number,
    searchType: SearchType
) {
    const [places, setPlaces] = useState<PlaceResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (searchType === 'none' || searchType === 'saved' || latitude === 0) {
            setPlaces([]);
            return;
        }

        let isMounted = true;

        const fetchPlacesNearby = async (radius: number = 20000) => {
            setIsLoading(true);
            setError(null);

            let includedTypes: string[] = [];
            if (searchType === 'gas') includedTypes = ['gas_station'];
            if (searchType === 'ev') includedTypes = ['electric_vehicle_charging_station'];
            if (searchType === 'gas_ev') includedTypes = ['gas_station', 'electric_vehicle_charging_station'];

            try {
                const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': GOOGLE_API_GENERAL_KEY,
                        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.shortFormattedAddress',
                    },
                    body: JSON.stringify({
                        includedTypes: includedTypes,
                        maxResultCount: 15,
                        locationRestriction: {
                            circle: {
                                center: { latitude, longitude },
                                radius: radius,
                            },
                        },
                    }),
                });

                const data = await response.json();

                // 🚨 PRINDEM EROAREA DE LA GOOGLE ȘI O AFIȘĂM 🚨
                if (data.error) {
                    console.error("❌ Google Places API Error:", data.error.message);
                    if (isMounted) {
                        setError(data.error.message);
                        setIsLoading(false);
                    }
                    return;
                }

                if (data.places && data.places.length > 0) {
                    processAndSetPlaces(data.places, searchType, isMounted);
                } else {
                    if (radius === 20000) {
                        await fetchPlacesNearby(50000);
                    } else {
                        await fetchPlacesTextFallback();
                    }
                }
            } catch (err) {
                if (isMounted) {
                    setError("Failed to fetch locations.");
                    setIsLoading(false);
                }
            }
        };

        const fetchPlacesTextFallback = async () => {
            let textQuery = 'gas station';
            if (searchType === 'ev') textQuery = 'EV charging station';
            if (searchType === 'gas_ev') textQuery = 'gas station or EV charging station';

            try {
                const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': GOOGLE_API_GENERAL_KEY,
                        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.shortFormattedAddress',
                    },
                    body: JSON.stringify({
                        textQuery: textQuery,
                        locationBias: {
                            circle: {
                                center: { latitude, longitude },
                                radius: 50000.0,
                            },
                        },
                    }),
                });

                const data = await response.json();

                if (data.error) {
                    console.error("❌ Google Fallback API Error:", data.error.message);
                    if (isMounted) {
                        setError(data.error.message);
                        setIsLoading(false);
                    }
                    return;
                }

                if (data.places && data.places.length > 0) {
                    processAndSetPlaces(data.places, searchType, isMounted);
                } else {
                    if (isMounted) {
                        setPlaces([]);
                        setError("No stations found anywhere near your location.");
                        setIsLoading(false);
                    }
                }
            } catch (err) {
                if (isMounted) {
                    setError("Failed to fetch fallback locations.");
                    setIsLoading(false);
                }
            }
        };

        const processAndSetPlaces = (rawPlaces: any[], type: SearchType, mounted: boolean) => {
            let mappedPlaces: PlaceResult[] = rawPlaces.map((p: any) => ({
                id: p.id,
                name: p.displayName?.text || 'Unknown Station',
                latitude: p.location.latitude,
                longitude: p.location.longitude,
                address: p.shortFormattedAddress || '',
            }));

            mappedPlaces = simulateBusinessLogic(mappedPlaces, type);

            if (mounted) {
                setPlaces(mappedPlaces);
                setIsLoading(false);
            }
        };

        fetchPlacesNearby();

        return () => {
            isMounted = false;
        };
    }, [latitude, longitude, searchType]);

    return { places, isLoading, error };
}

function simulateBusinessLogic(places: PlaceResult[], type: SearchType): PlaceResult[] {
    return places.map((place, index) => {
        if ((type === 'gas' || type === 'gas_ev') && index < 2) {
            place.isSponsored = true;
        }

        if ((type === 'ev' || type === 'gas_ev') && Math.random() > 0.8) {
            place.name = `${place.name} *`;
            place.hasHydrogen = true;
        }

        return place;
    });
}