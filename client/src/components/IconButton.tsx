import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

interface IconButtonProps {
    icon: React.ReactNode;
    onPress?: () => void;
    style?: object;
}

export const IconButton = ({ icon, onPress, style }: IconButtonProps) => (
    <TouchableOpacity style={[styles.button, style]} onPress={onPress}>
        {icon}
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    button: {
        padding: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
});