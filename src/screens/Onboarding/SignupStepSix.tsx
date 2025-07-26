import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const options = ['Male', 'Female', 'TS'];

const SignupStepSix = () => {
  const navigation = useNavigation();
  const route = useRoute();

  const { screenname, first_name, phone } = route.params || {};

  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);

  const toggleSelection = (value: string) => {
    setSelectedPrefs(prev =>
      prev.includes(value)
        ? prev.filter(p => p !== value)
        : [...prev, value]
    );
  };

  const handleNext = async () => {
    if (selectedPrefs.length === 0) {
      Alert.alert('Hold Up!', `Pick at least one preference${screenname ? `, @${screenname}` : ''}`);
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id || !userData.user.email) {
      Alert.alert('Error', 'User not authenticated.');
      return;
    }

    const { user } = userData;

    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      screenname,
      first_name,
      phone,
      preferences: selectedPrefs,
      current_step: 'ProfileSetupStepSix',
    });

    if (upsertError) {
      console.error('[Supabase Upsert Error]', upsertError);
      Alert.alert('Error', 'Could not save your preferences.');
      return;
    }

    navigation.navigate('ProfileSetupStepSeven', {
      screenname,
      first_name,
      phone,
    });
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>
          {screenname ? `Who are you into, @${screenname}? 💖` : 'Who are you into? 💖'}
        </Text>

        <View style={styles.optionsWrapper}>
          {options.map(option => {
            const isSelected = selectedPrefs.includes(option);
            return (
              <TouchableOpacity
                key={option}
                style={[
                  styles.optionButton,
                  isSelected && styles.optionButtonSelected,
                ]}
                onPress={() => toggleSelection(option)}
              >
                <Text
                  style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                  ]}
                >
                  {option}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ marginTop: 40 }}>
          <OnboardingNavButtons onNext={handleNext} disabled={selectedPrefs.length === 0} />
        </View>
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
    marginBottom: 30,
    textAlign: 'center',
  },
  optionsWrapper: {
    gap: 15,
  },
  optionButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    backgroundColor: '#f2f2f2',
    borderRadius: 10,
    borderColor: '#ccc',
    borderWidth: 1,
    marginBottom: 10,
  },
  optionButtonSelected: {
    backgroundColor: '#ff5a5f',
    borderColor: '#ff5a5f',
  },
  optionText: {
    fontSize: 18,
    textAlign: 'center',
    color: '#333',
  },
  optionTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default SignupStepSix;
