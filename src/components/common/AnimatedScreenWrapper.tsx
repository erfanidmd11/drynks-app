import React, { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  FadeInRight,
  FadeOutLeft,
} from 'react-native-reanimated';

interface Props {
  children: ReactNode;
}

const AnimatedScreenWrapper = ({ children }: Props) => {
  const EnterAnim = FadeInRight.duration(500);
  const ExitAnim = FadeOutLeft.duration(300);

  return (
    <Animated.View
      entering={EnterAnim}
      exiting={ExitAnim}
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
