// SignupStepFive.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const SignupStepFive = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { username } = route.params as { username: string };

  const [gender, setGender] = useState('');

  const handleNext = async () => {
    if (!gender) {
      Alert.alert('Required', 'Please select your gender.');
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      await supabase.from('profiles').upsert({
        id: userData.user.id,
        gender,
        current_step: 'ProfileSetupStepFive',
      });
    }

    navigation.navigate('ProfileSetupStepSix', { username });
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>Hey @{username}, how do you identify? 🌈</Text>

        <Picker
          selectedValue={gender}
          onValueChange={(item) => setGender(item)}
          style={styles.picker}>
          <Picker.Item label="Select Gender" value="" />
          <Picker.Item label="Male" value="Male" />
          <Picker.Item label="Female" value="Female" />
          <Picker.Item label="TS" value="TS" />
        </Picker>

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
  picker: {
    height: 50,
    marginBottom: 20,
  },
});

export default SignupStepFive;
