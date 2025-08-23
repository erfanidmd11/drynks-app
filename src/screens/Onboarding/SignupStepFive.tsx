import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

const genderOptions = ['Male', 'Female', 'TS'];

const SignupStepFive = () => {
  // Casts keep us moving while the global nav types are finalized
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const { screenname, first_name, phone } = route.params ?? {};

  const [gender, setGender] = useState('');

  const handleNext = async () => {
    if (!gender) {
      Alert.alert('Required', 'Please select your gender.');
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
      gender,
      current_step: 'ProfileSetupStepFive',
    });

    if (upsertError) {
      console.error('[Supabase Upsert Error]', upsertError);
      Alert.alert('Error', 'Could not save your selection.');
      return;
    }

    navigation.navigate('ProfileSetupStepSix' as never, {
      screenname,
      first_name,
      phone,
    } as never);
  };

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <View style={styles.container}>
        <Text style={styles.header}>
          {screenname ? `Hey @${screenname}, how do you identify? 🙂` : 'How do you identify? 🙂'}
        </Text>

        <View style={styles.optionsWrapper}>
          {genderOptions.map(option => (
            <TouchableOpacity
              key={option}
              onPress={() => setGender(option)}
              style={[
                styles.optionButton,
                gender === option && styles.optionButtonSelected,
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  gender === option && styles.optionTextSelected,
                ]}
              >
                {option}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ marginTop: 40 }}>
          <OnboardingNavButtons
            onNext={handleNext}
            {...({ disabled: !gender } as any)} // cast extra prop to satisfy TS
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
    flexDirection: 'column',
    gap: 15,
  },
  optionButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    backgroundColor: DRYNKS_GRAY,
    borderRadius: 10,
    borderColor: '#DADFE6',
    borderWidth: 1,
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

export default SignupStepFive;
