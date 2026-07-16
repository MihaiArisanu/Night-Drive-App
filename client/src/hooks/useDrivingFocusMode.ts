import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_IDLE_TIMEOUT_MS = 10_000;

interface DrivingFocusModeOptions {
  paused?: boolean;
  timeoutMs?: number;
}

export function useDrivingFocusMode({
  paused = false,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
}: DrivingFocusModeOptions = {}) {
  const [isFocusModeActive, setIsFocusModeActive] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (!idleTimer.current) return;
    clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }, []);

  const startIdleTimer = useCallback(() => {
    clearIdleTimer();
    if (paused) return;

    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      setIsFocusModeActive(true);
    }, timeoutMs);
  }, [clearIdleTimer, paused, timeoutMs]);

  const registerInteraction = useCallback(() => {
    setIsFocusModeActive(false);
    startIdleTimer();
  }, [startIdleTimer]);

  useEffect(() => {
    if (paused) {
      clearIdleTimer();
      setIsFocusModeActive(false);
      return clearIdleTimer;
    }

    startIdleTimer();
    return clearIdleTimer;
  }, [clearIdleTimer, paused, startIdleTimer]);

  return {
    isFocusModeActive,
    registerInteraction,
  };
}
