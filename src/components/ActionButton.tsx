import React from 'react';
import { StyleSheet, Text, TextStyle, TouchableOpacity, ViewStyle } from 'react-native';

interface ActionButtonProps {
    title: string;
    onPress?: () => void;
    variant?: 'primary' | 'outline' | 'danger';
    style?: ViewStyle;
    textStyle?: TextStyle;
}

export const ActionButton = ({ title, onPress, variant = 'primary', style, textStyle }: ActionButtonProps) => {
    return (
        <TouchableOpacity
            style={[styles.button, styles[variant], style]}
            onPress={onPress}
            activeOpacity={0.8}
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
    }
});