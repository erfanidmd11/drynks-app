// SignupStepSix.tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const options = ['Male', 'Female', 'TS'];

const SignupStepSix = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { username } = route.params as { username: string };

  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);

  const toggleSelection = (value: string) => {
    setSelectedPrefs(prev =>
      prev.includes(value) ? prev.filter(p => p !== value) : [...prev, value]
    );
  };

  const handleNext = async () => {
    if (selectedPrefs.length === 0) {
      Alert.alert('Hold Up!', 'Pick at least one preference, @' + username);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      await supabase.from('profiles').upsert({
        id: userData.user.id,
        preferences: selectedPrefs,
        current_step: 'ProfileSetupStepSix',
      });
    }

    navigation.navigate('ProfileSetupStepSeven', { username });
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>And who makes your heart skip a beat, @{username}? 💘</Text>

        {options.map(option => (
          <TouchableOpacity
            key={option}
            style={styles.option}
            onPress={() => toggleSelection(option)}>
            <Text style={styles.checkbox}>{selectedPrefs.includes(option) ? '☑' : '☐'}</Text>
            <Text style={styles.optionText}>{option}</Text>
          </TouchableOpacity>
        ))}

        <OnboardingNavButtons onNext={handleNext} />
      </View>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  checkbox: {
    fontSize: 20,
    marginRight: 10,
  },
  optionText: {
    fontSize: 18,
  },
});

export default SignupStepSix;
