import React, { ReactNode } from 'react';
import { View, StyleSheet, Image, TouchableOpacity, Text, ViewStyle } from 'react-native';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';

interface Props {
  children: ReactNode;
  showLogo?: boolean;
  /** Show a simple "← Back" control in the header area */
  showBack?: boolean;
  /** Called when the back control is pressed */
  onBack?: () => void;
  /** Optional style to override the outer container (e.g., backgroundColor) */
  style?: ViewStyle | ViewStyle[];
}

const AnimatedScreenWrapper = ({
  children,
  showLogo = true,
  showBack = false,
  onBack,
  style,
}: Props) => {
  const EnterAnim = FadeInRight.duration(500);
  const ExitAnim = FadeOutLeft.duration(300);

  return (
    <Animated.View
      entering={EnterAnim}
      exiting={ExitAnim}
      style={[styles.container, style]}
    >
      {(showLogo || showBack) && (
        <View style={styles.header}>
          {showBack && (
            <TouchableOpacity
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={styles.backBtn}
            >
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          )}

          {showLogo && (
            <Image
              source={require('../../../assets/images/DrYnks_Y_logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          )}
        </View>
      )}

      <View style={styles.content}>{children}</View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff', // can be overridden via the 'style' prop
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingBottom: 30,
  },
  backBtn: {
    position: 'absolute',
    left: 20,
    top: 66, // visually aligned with header's paddingTop
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#232F39', // DRYNKS_BLUE
  },
  logo: {
    width: 120,
    height: 120,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
});

export default AnimatedScreenWrapper;
