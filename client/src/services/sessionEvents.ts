export interface SessionInvalidation {
    message: string;
}

type SessionInvalidationListener = (event: SessionInvalidation) => void;

const listeners = new Set<SessionInvalidationListener>();

export const subscribeToSessionInvalidation = (listener: SessionInvalidationListener) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const notifySessionInvalidated = (
    message = 'Your account is now active on another device.',
) => {
    listeners.forEach((listener) => listener({ message }));
};
