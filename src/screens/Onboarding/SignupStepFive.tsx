import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const genderOptions = ['Male', 'Female', 'TS'];

const SignupStepFive = () => {
  const navigation = useNavigation();
  const route = useRoute();

  const { screenname, first_name, phone } = route.params || {};

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

    navigation.navigate('ProfileSetupStepSix', {
      screenname,
      first_name,
      phone,
    });
  };

  return (
    <AnimatedScreenWrapper>
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
          <OnboardingNavButtons onNext={handleNext} disabled={!gender} />
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
    flexDirection: 'column',
    gap: 15,
  },
  optionButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    borderColor: '#ccc',
    borderWidth: 1,
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

export default SignupStepFive;
