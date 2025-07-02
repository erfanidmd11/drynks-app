// Patched AnimatedScreenWrapper.tsx with fallback
import React, { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';

interface Props {
  children: ReactNode;
}

const AnimatedScreenWrapper = ({ children }: Props) => {
  return (
    <Animated.View
      entering={FadeInRight?.duration?.(500) ?? undefined}
      exiting={FadeOutLeft?.duration?.(300) ?? undefined}
      style={styles.container}
    >
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});

export default AnimatedScreenWrapper;
