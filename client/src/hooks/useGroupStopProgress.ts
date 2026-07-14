import { useEffect, useRef } from 'react';
import { apiFetch } from '../services/api';
import { GroupStop, useSettingsStore } from '../store/useSettingsStore';

interface GroupStopProgressResponse {
    resolvedStopIds: string[];
}

const PROGRESS_CHECK_INTERVAL_MS = 5000;

export function useGroupStopProgress(
    groupId: string | null,
    stops: GroupStop[],
    latitude: number,
) {
    const isChecking = useRef(false);
    const removeGroupStop = useSettingsStore((state) => state.removeGroupStop);
    const stopRevision = stops.map((stop) => stop.id).join('|');
    const hasLocation = latitude !== 0;

    useEffect(() => {
        if (!groupId || !stopRevision || !hasLocation) return;

        let cancelled = false;

        const evaluateStops = async () => {
            if (isChecking.current) return;
            isChecking.current = true;
            try {
                try {
                    const progress = await apiFetch(
                        `/groups/${groupId}/stops/evaluate`,
                        { method: 'POST' },
                    ) as GroupStopProgressResponse;
                    if (!cancelled) {
                        (progress?.resolvedStopIds || []).forEach(removeGroupStop);
                    }
                } catch (error) {
                    console.warn('[GroupStop] Could not evaluate progress:', error);
                }
            } finally {
                isChecking.current = false;
            }
        };

        evaluateStops();
        const interval = setInterval(evaluateStops, PROGRESS_CHECK_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [groupId, hasLocation, removeGroupStop, stopRevision]);
}
