import { Platform } from 'react-native';
import {
    getCrashlytics,
    log,
    recordError,
    setAttributes,
    setCrashlyticsCollectionEnabled,
    setUserId,
} from '@react-native-firebase/crashlytics';

type CrashAttributes = Record<string, string | number | boolean | null | undefined>;

const crashlytics = getCrashlytics();
const MAX_ATTRIBUTE_LENGTH = 100;

const isEnabled = () => !__DEV__;

const normalizeError = (error: unknown): Error => {
    if (error instanceof Error) {
        return error;
    }

    if (typeof error === 'string') {
        return new Error(error);
    }

    return new Error('Unknown application error');
};

const sanitizeAttributes = (attributes: CrashAttributes): Record<string, string> => (
    Object.entries(attributes).reduce<Record<string, string>>((result, [key, value]) => {
        if (value !== null && value !== undefined) {
            result[key] = String(value).slice(0, MAX_ATTRIBUTE_LENGTH);
        }
        return result;
    }, {})
);

const safely = async (operation: () => Promise<unknown>) => {
    try {
        await operation();
    } catch (error) {
        console.warn('Crash reporting operation failed:', error);
    }
};

export const initializeCrashReporting = async () => {
    if (!isEnabled()) {
        return;
    }

    await safely(async () => {
        await setCrashlyticsCollectionEnabled(crashlytics, true);
        await setAttributes(crashlytics, {
            platform: Platform.OS,
            build_mode: 'release',
        });
        log(crashlytics, 'NightDrive application started');
    });
};

export const identifyCrashReportingUser = async (userId: string | null) => {
    if (!isEnabled()) {
        return;
    }

    await safely(() => setUserId(crashlytics, userId ?? ''));
};

export const recordNonFatalError = async (
    error: unknown,
    context: string,
    attributes: CrashAttributes = {},
) => {
    if (!isEnabled()) {
        return;
    }

    await safely(async () => {
        const safeAttributes = sanitizeAttributes({
            ...attributes,
            error_context: context,
        });

        if (Object.keys(safeAttributes).length > 0) {
            await setAttributes(crashlytics, safeAttributes);
        }

        log(crashlytics, `Non-fatal error: ${context}`);
        recordError(crashlytics, normalizeError(error), context);
    });
};
