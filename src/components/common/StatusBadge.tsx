import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const statusMeta = {
  open:   { color: '#4CAF50', icon: 'rocket', label: 'Spots Left 🚀' },
  filled: { color: '#FFA500', icon: 'people', label: 'Fully Booked 👯' },
  closed: { color: '#F44336', icon: 'lock-closed', label: 'Closed 🍷' },
};

const StatusBadge = ({ status }: { status: 'open' | 'filled' | 'closed' }) => {
  const meta = statusMeta[status] || statusMeta['open'];

  return (
    <View style={[styles.badge, { backgroundColor: meta.color + '22' }]}>
      <Ionicons name={meta.icon as any} size={14} color={meta.color} style={styles.icon} />
      <Text style={[styles.text, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  icon: {
    marginRight: 2,
  },
});

export default StatusBadge;
