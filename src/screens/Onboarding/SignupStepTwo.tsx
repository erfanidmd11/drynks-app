// src/screens/Onboarding/SignupStepTwo.tsx

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  Keyboard,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '@components/common/OnboardingNavButtons';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

const SignupStepTwo = () => {
  // Cast to avoid fighting global nav typing while root map is finalized
  const navigation = useNavigation<any>();
  const [dob, setDob] = useState('');

  const formatDob = (input: string) => {
    const digitsOnly = input.replace(/[^\d]/g, '');
    let formatted = '';

    if (digitsOnly.length <= 2) {
      formatted = digitsOnly;
    } else if (digitsOnly.length <= 4) {
      formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2)}`;
    } else {
      formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4, 8)}`;
    }

    setDob(formatted);
  };

  const handleNext = async () => {
    const [month, day, year] = dob.split('/').map(Number);
    const birthdate = new Date(year, month - 1, day);

    if (isNaN(birthdate.getTime())) {
      Alert.alert('Invalid Date', 'Please enter a valid date in MM/DD/YYYY format.');
      return;
    }

    const today = new Date();
    const age = today.getFullYear() - birthdate.getFullYear();
    const monthDiff = today.getMonth() - birthdate.getMonth();
    const dayDiff = today.getDate() - birthdate.getDate();
    const finalAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.email || !userData?.user?.id) {
        Alert.alert('Error', 'User not authenticated.');
        return;
      }

      const email = userData.user.email;
      const userId = userData.user.id;
      const formattedBirthdate = birthdate.toISOString().split('T')[0];

      if (finalAge < 18) {
        await supabase.from('waitlist_underage').insert({ email, birthdate: formattedBirthdate });
        Alert.alert(
          'Almost There 🥲',
          'DrYnks is 18+ only. But hey, we’ll save you a spot! We’ll ping you with a birthday cheers and a sweet invite when the time is right. 🎉'
        );
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('screenname, first_name, phone')
        .eq('id', userId)
        .maybeSingle();

      const screenname = profileData?.screenname ?? '';
      const first_name = profileData?.first_name ?? '';
      const phone = profileData?.phone ?? '';

      const { error: upsertError } = await supabase.from('profiles').upsert(
        {
          id: userId,
          email,
          screenname,
          first_name,
          phone,
          birthdate: formattedBirthdate,
          current_step: 'ProfileSetupStepTwo',
        },
        { onConflict: 'id' }
      );

      if (upsertError) {
        console.error('[Supabase Upsert Error]', upsertError);
        Alert.alert('Database Error', 'Could not save your birthdate.');
        return;
      }

      // Cast nav target to satisfy TS without changing your route
      navigation.navigate('ProfileSetupStepThree' as never);
    } catch (err) {
      console.error('[SignupStepTwo Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <Text style={styles.header}>Your Birthday 🎂</Text>
            <Text style={styles.subtext}>Let’s make sure you’re old enough to sip on DrYnks.</Text>

            <TextInput
              style={styles.input}
              placeholder="MM/DD/YYYY"
              value={dob}
              onChangeText={formatDob}
              keyboardType="number-pad"
              placeholderTextColor="#8A94A6"
              maxLength={10}
              returnKeyType="done"
              blurOnSubmit
            />

            <OnboardingNavButtons onNext={handleNext} />
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
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
    marginBottom: 10,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  subtext: {
    textAlign: 'center',
    color: '#55606B',
    marginBottom: 20,
  },
  input: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 20,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
});

export default SignupStepTwo;
