// src/components/SwipeAffordance.tsx
import * as React from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function SwipeAffordance({ side = 'both', visible = true }: { side?: 'left'|'right'|'both', visible?: boolean }) {
  const t = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!visible) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 850, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 850, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, [t, visible]);

  if (!visible) return null;

  const shift = (dir: 'left'|'right') => ({
    transform: [{ translateX: t.interpolate({
      inputRange: [0,1],
      outputRange: dir === 'left' ? [0, -6] : [0, 6],
    }) }],
    opacity: t.interpolate({ inputRange: [0,1], outputRange: [0.7, 1] }),
  });

  return (
    <>
      {(side==='left' || side==='both') && (
        <View pointerEvents="none" style={[styles.hint, { left: 8 }]}>
          <Animated.View style={shift('left')}>
            <Ionicons name="arrow-back" size={18} color="#e74c3c" />
          </Animated.View>
          <Text style={[styles.hintText, { color: '#e74c3c' }]}>Swipe left to decline</Text>
        </View>
      )}
      {(side==='right' || side==='both') && (
        <View pointerEvents="none" style={[styles.hint, { right: 8, flexDirection: 'row-reverse' }]}>
          <Animated.View style={shift('right')}>
            <Ionicons name="arrow-forward" size={18} color="#27ae60" />
          </Animated.View>
          <Text style={[styles.hintText, { color: '#27ae60' }]}>Swipe right to accept</Text>
        </View>
      )}
      <View pointerEvents="none" style={styles.grip} />
    </>
  );
}

const styles = StyleSheet.create({
  hint: {
    position: 'absolute', top: 10, alignItems: 'center',
    flexDirection: 'row', gap: 6,
  },
  hintText: { fontSize: 12, fontWeight: '600' },
  grip: {
    position: 'absolute', bottom: 8, left: '50%', marginLeft: -18,
    width: 36, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(0,0,0,0.14)',
  },
});
