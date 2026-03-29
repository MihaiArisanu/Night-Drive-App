import React from 'react';
import { StyleSheet, Text, TextStyle, TouchableOpacity, ViewStyle, StyleProp } from 'react-native';

interface ActionButtonProps {
    title: string;
    onPress?: () => void;
    variant?: 'primary' | 'outline' | 'danger';
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    disabled?: boolean;
}

export const ActionButton = ({ title, onPress, variant = 'primary', style, textStyle, disabled }: ActionButtonProps) => {
    return (
        <TouchableOpacity
            style={[styles.button, styles[variant], style, disabled && styles.disabled]}
            onPress={onPress}
            activeOpacity={0.8}
            disabled={disabled}
        >
            <Text style={[styles.text, textStyle]}>{title}</Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    button: {
        paddingVertical: 15,
        paddingHorizontal: 30,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 150,
    },
    text: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    primary: {
        backgroundColor: '#A855F7',
    },
    outline: {
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: '#A855F7',
    },
    danger: {
        backgroundColor: '#EF4444',
    },
    disabled: {
        opacity: 0.5,
    }
});