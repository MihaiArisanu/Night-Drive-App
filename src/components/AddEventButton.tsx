import { Plus } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

interface AddEventButtonProps {
    onPress?: () => void;
}

export const AddEventButton = ({ onPress }: AddEventButtonProps) => (
    <TouchableOpacity style={styles.button} onPress={onPress}>
        <Plus color="white" size={32} />
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    button: {
        backgroundColor: '#1A1A1A',
        width: 60, height: 60, borderRadius: 30,
        justifyContent: 'center', alignItems: 'center',
        borderWidth: 1, borderColor: '#333',
        marginBottom: 5,
    },
});