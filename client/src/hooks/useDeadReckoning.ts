import { useState, useEffect, useRef } from 'react';

interface Coords {
  latitude: number;
  longitude: number;
}

export const useDeadReckoning = (
  realCoords: Coords,
  speedMs: number,
  heading: number
) => {
  const [activeCoords, setActiveCoords] = useState<Coords>(realCoords);
  const [isSimulating, setIsSimulating] = useState(false);

  const lastUpdateTime = useRef<number>(Date.now());
  const simulationInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (realCoords.latitude === 0) return;

    lastUpdateTime.current = Date.now();
    setActiveCoords(realCoords);

    if (isSimulating) {
      console.log("GPS restabilit! Oprim simularea.");
      setIsSimulating(false);
    }

  }, [realCoords]);

  useEffect(() => {
    simulationInterval.current = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - lastUpdateTime.current;

      if (timeSinceLastUpdate > 3000 && speedMs > 2) {
        if (!isSimulating) {
          console.log("Semnal GPS pierdut! Începem simularea inerțială (Dead Reckoning)...");
          setIsSimulating(true);
        }

        setActiveCoords((prevCoords) => {
          const R = 6378137;
          const dist = speedMs * 1;
          const brng = heading * (Math.PI / 180);

          const lat1 = prevCoords.latitude * (Math.PI / 180);
          const lon1 = prevCoords.longitude * (Math.PI / 180);

          const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(dist / R) +
            Math.cos(lat1) * Math.sin(dist / R) * Math.cos(brng)
          );
          const lon2 = lon1 + Math.atan2(
            Math.sin(brng) * Math.sin(dist / R) * Math.cos(lat1),
            Math.cos(dist / R) - Math.sin(lat1) * Math.sin(lat2)
          );

          return {
            latitude: lat2 * (180 / Math.PI),
            longitude: lon2 * (180 / Math.PI),
          };
        });
      }
    }, 1000);

    return () => {
      if (simulationInterval.current) clearInterval(simulationInterval.current);
    };
  }, [speedMs, heading, isSimulating]);

  return { activeCoords, isSimulating };
};