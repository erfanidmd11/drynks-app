 b// SignupStepTwo.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const SignupStepTwo = () => {
  const navigation = useNavigation();
  const [dob, setDob] = useState('');

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

    const { data: userData } = await supabase.auth.getUser();
    const email = userData?.user?.email || '';

    if (finalAge < 18) {
      await supabase.from('waitlist_underage').insert({ email, birthdate });
      Alert.alert(
        'Almost There 🥲',
        'DrYnks is 18+ only. But hey, we’ll save you a spot! We’ll ping you with a birthday cheers and a sweet invite when the time is right. 🎉'
      );
      return;
    }

    if (userData?.user) {
      await supabase.from('profiles').upsert({
        id: userData.user.id,
        birthdate,
        current_step: 'ProfileSetupStepTwo',
      });
    }

    navigation.navigate('ProfileSetupStepThree');
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>Your Birthday 🎂</Text>
        <Text style={styles.subtext}>Let’s make sure you’re old enough to sip on DrYnks.</Text>

        <TextInput
          style={styles.input}
          placeholder="MM/DD/YYYY"
          value={dob}
          onChangeText={setDob}
          keyboardType="number-pad"
          placeholderTextColor="#999"
        />

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
    marginBottom: 10,
    textAlign: 'center',
  },
  subtext: {
    textAlign: 'center',
    color: '#666',
    marginBottom: 20,
  },
  input: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 20,
    fontSize: 16,
  },
});

export default SignupStepTwo;