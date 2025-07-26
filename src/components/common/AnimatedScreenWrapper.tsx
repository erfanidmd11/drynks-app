import React, { ReactNode } from 'react';
import { View, StyleSheet, Image, Text } from 'react-native';
import Animated, {
  FadeInRight,
  FadeOutLeft,
} from 'react-native-reanimated';

interface Props {
  children: ReactNode;
  showLogo?: boolean;
  userId?: string | null;
  datesCount?: number;
}

const AnimatedScreenWrapper = ({
  children,
  showLogo = true,
  userId,
  datesCount,
}: Props) => {
  const EnterAnim = FadeInRight.duration(500);
  const ExitAnim = FadeOutLeft.duration(300);

  return (
    <Animated.View
      entering={EnterAnim}
      exiting={ExitAnim}
      style={styles.container}
    >
      {showLogo && (
        <View style={styles.logoContainer}>
          <Image
            source={require('../../../assets/images/DrYnks_Y_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
      )}

      {/* Debug info always shown */}
      <View style={styles.debugInfo}>
        <Text style={styles.debugText}>User ID: {userId || 'Not signed in'}</Text>
        <Text style={styles.debugText}>Dates Loaded: {datesCount ?? 'N/A'}</Text>
      </View>

      <View style={styles.content}>{children}</View>
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
    marginTop: 60,
    marginBottom: 30,
  },
  logo: {
    width: 120,
    height: 120,
  },
  debugInfo: {
    marginHorizontal: 20,
    marginBottom: 10,
  },
  debugText: {
    fontSize: 12,
    color: 'gray',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
});

export default AnimatedScreenWrapper;
