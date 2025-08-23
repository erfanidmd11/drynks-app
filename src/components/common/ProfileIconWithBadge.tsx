import React from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  count?: number;
  onPress?: () => void;
};

const ProfileIconWithBadge: React.FC<Props> = ({ count = 0, onPress }) => {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress}>
      <Ionicons name="person-circle-outline" size={40} color="#232F39" />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    padding: 4,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: -2,
    backgroundColor: '#E34E5C',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});

export default ProfileIconWithBadge;
