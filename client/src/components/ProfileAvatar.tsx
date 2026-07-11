import React, { useEffect, useMemo, useState } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import { getAvatarSource } from '../services/api';

interface ProfileAvatarProps {
    profilePictureUrl?: string | null;
    localUri?: string | null;
    size: number;
    style?: StyleProp<ImageStyle>;
}

export function ProfileAvatar({ profilePictureUrl, localUri, size, style }: ProfileAvatarProps) {
    const [hasRemoteError, setHasRemoteError] = useState(false);
    const remoteSource = useMemo(
        () => getAvatarSource(profilePictureUrl),
        [profilePictureUrl],
    );

    useEffect(() => {
        setHasRemoteError(false);
    }, [profilePictureUrl, localUri]);

    const source = localUri
        ? { uri: localUri }
        : (!hasRemoteError && remoteSource ? remoteSource : require('../assets/logo.png'));

    return (
        <Image
            source={source}
            style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
            onError={() => setHasRemoteError(true)}
        />
    );
}
