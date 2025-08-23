// src/screens/Onboarding/SignupStepSix.tsx

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

const options = ['Male', 'Female', 'TS'];

const SignupStepSix = () => {
  // Casts avoid fighting global nav typing while the root map is finalized
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const { screenname, first_name, phone } = route.params ?? {};

  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);

  const toggleSelection = (value: string) => {
    setSelectedPrefs(prev =>
      prev.includes(value) ? prev.filter(p => p !== value) : [...prev, value]
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

    navigation.navigate('ProfileSetupStepSeven' as never, {
      screenname,
      first_name,
      phone,
    } as never);
  };

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
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
                style={[styles.optionButton, isSelected && styles.optionButtonSelected]}
                onPress={() => toggleSelection(option)}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {option}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ marginTop: 40 }}>
          <OnboardingNavButtons
            onNext={handleNext}
            {...({ disabled: selectedPrefs.length === 0 } as any)}  // TS-safe prop cast
          />
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
    backgroundColor: DRYNKS_WHITE,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 30,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  optionsWrapper: {
    gap: 15,
  },
  optionButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    backgroundColor: DRYNKS_GRAY,
    borderRadius: 10,
    borderColor: '#DADFE6',
    borderWidth: 1,
    marginBottom: 10,
  },
  optionButtonSelected: {
    backgroundColor: DRYNKS_RED,
    borderColor: DRYNKS_RED,
  },
  optionText: {
    fontSize: 18,
    textAlign: 'center',
    color: '#23303A',
  },
  optionTextSelected: {
    color: DRYNKS_WHITE,
    fontWeight: '700',
  },
});

export default SignupStepSix;
