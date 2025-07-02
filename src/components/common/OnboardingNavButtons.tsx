// OnboardingNavButtons.tsx (Crash-Safe Version)
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface Props {
  onNext: () => void;
  showBack?: boolean;
}

const OnboardingNavButtons = ({ onNext, showBack = true }: Props) => {
  const navigation = useNavigation();

  return (
    <View style={styles.navRow}>
      {showBack && navigation.canGoBack() && (
        <TouchableOpacity
          style={[styles.button, styles.back]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.button} onPress={onNext}>
        <Text style={styles.buttonText}>Next</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 30,
    paddingHorizontal: 10,
  },
  button: {
    flex: 1,
    backgroundColor: '#ff5a5f',
    marginHorizontal: 5,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  back: {
    backgroundColor: '#ddd',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default OnboardingNavButtons;
