// src/components/nav/RoundedBackButton.tsx
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

type Props = { onPress: () => void; label?: string };

export default function RoundedBackButton({ onPress, label = 'Back' }: Props) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.btn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Ionicons name="chevron-back" size={18} color={DRYNKS_BLUE} />
      <Text style={styles.txt}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DRYNKS_WHITE,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  txt: { color: DRYNKS_BLUE, fontWeight: '700', marginLeft: 2, fontSize: 14 },
});
