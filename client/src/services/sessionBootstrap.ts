import { apiFetch } from './api';
import { restoreCurrentGroup } from './groupSession';
import { useSettingsStore } from '../store/useSettingsStore';
import { identifyCrashReportingUser } from './crashReporting';

interface AuthenticatedUserIdentity {
    id: string;
    name: string;
}

export async function restoreCurrentUserIdentity() {
    const user = await apiFetch('/users/me') as AuthenticatedUserIdentity;
    const settings = useSettingsStore.getState();
    settings.setUserId(user.id);
    settings.setUserName(user.name);
    await identifyCrashReportingUser(user.id);
    return user;
}

export async function restoreAuthenticatedSession() {
    const captureFailure = (operation: Promise<unknown>) => operation.then(
        () => null,
        (error: unknown) => error,
    );
    const failures = await Promise.all([
        captureFailure(restoreCurrentUserIdentity()),
        captureFailure(restoreCurrentGroup()),
    ]);
    const failure = failures.find((error) => error !== null);
    if (failure) {
        throw failure;
    }
}
