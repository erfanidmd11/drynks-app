// Fully Cleaned SplashScreen.tsx (Routing Handled by AppNavigator)
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

const SplashScreen = () => {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../../assets/images/drYnks_logo.png')}
        style={styles.logo}
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
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  logo: {
    width: 120,
    height: 120,
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
