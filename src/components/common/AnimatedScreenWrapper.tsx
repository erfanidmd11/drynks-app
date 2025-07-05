import React, { ReactNode } from 'react';
import { View, StyleSheet, Image } from 'react-native';
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
      <View style={styles.logoContainer}>
        <Image
          source={require('../../../assets/images/DrYnks_Y_logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <View style={styles.content}>
        {children}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 20,
  },
  logo: {
    width: 60,
    height: 60,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
});

export default AnimatedScreenWrapper;
