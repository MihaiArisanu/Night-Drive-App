import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface SpeedBoxProps {
  speed: number;
  limit: number;
}

export const SpeedBox = ({ speed, limit }: SpeedBoxProps) => {
  const isSpeeding = speed > limit;

  return (
    <View style={[styles.speedBox, isSpeeding && styles.speedLimitExceeded]}>
      <Text style={styles.speedValue}>{speed}</Text>
      <Text style={styles.speedLabel}>KM/H</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  speedBox: {
    backgroundColor: '#111111',
    width: 90,
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#A855F7',
  },
  speedLimitExceeded: {
    borderColor: '#EF4444',
    backgroundColor: '#2D0000',
  },
  speedValue: { color: 'white', fontSize: 28, fontWeight: '900' },
  speedLabel: { color: 'white', fontSize: 10, fontWeight: 'bold' },
});