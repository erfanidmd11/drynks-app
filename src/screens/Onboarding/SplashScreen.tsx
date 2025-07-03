// src/screens/Onboarding/SplashScreen.tsx
import React from 'react';
import { View, Text, StyleSheet, Image, Platform } from 'react-native';

const SplashScreen = () => {
  console.log('🟡 SplashScreen rendered');

  return (
    <View style={styles.container}>
      <Image
        source={require('../../../assets/images/drYnks_logo.png')}
        style={styles.logo}
        resizeMode="contain"
        onError={(e) => console.log('❌ Image load error:', e.nativeEvent.error)}
      />
      <Text style={styles.tagline}>
        Your Plus-One for Yacht Parties, Concerts & the Unexpected.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  logo: {
    width: Platform.OS === 'ios' ? 140 : 120,
    height: Platform.OS === 'ios' ? 140 : 120,
    marginBottom: 20,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    color: '#333',
  },
});

export default SplashScreen;
