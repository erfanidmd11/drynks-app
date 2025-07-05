// src/screens/Onboarding/SignupStepFour.tsx

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const SignupStepFour = () => {
  const navigation = useNavigation();
  const [countryCode, setCountryCode] = useState('+1');
  const [phone, setPhone] = useState('');

  const handleNext = async () => {
    const fullPhone = `${countryCode}${phone}`;

    if (!phone) {
      Alert.alert('Missing Info', 'Phone number is required.');
      return;
    }

    try {
      const { data: duplicate, error: checkError } = await supabase
        .from('profiles')
        .select('phone')
        .eq('phone', fullPhone);

      if (checkError) {
        Alert.alert('Error', 'Could not verify phone number uniqueness.');
        return;
      }

      if (duplicate && duplicate.length > 0) {
        Alert.alert(
          'Already Registered',
          'This phone number is already associated with another account. You can log in instead.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Go to Login', onPress: () => navigation.navigate('Login') },
          ]
        );
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.id) {
        Alert.alert('Error', 'User authentication failed.');
        return;
      }

      await supabase.from('profiles').upsert({
        id: userData.user.id,
        phone: fullPhone,
        current_step: 'ProfileSetupStepFour',
      });

      navigation.navigate('ProfileSetupStepFive');
    } catch (err) {
      console.error('[SignupStepFour Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  return (
    <AnimatedScreenWrapper>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <Text style={styles.header}>How Can We Reach You? 📱</Text>

            <View style={styles.phoneRow}>
              <Picker
                selectedValue={countryCode}
                style={styles.picker}
                onValueChange={(itemValue) => setCountryCode(itemValue)}
              >
                <Picker.Item label="+1 (US)" value="+1" />
                <Picker.Item label="+44 (UK)" value="+44" />
                <Picker.Item label="+91 (India)" value="+91" />
              </Picker>

              <TextInput
                style={styles.phoneInput}
                placeholder="Phone Number"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            </View>

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
    backgroundColor: '#fff',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  picker: {
    flex: 1,
    height: 50,
  },
  phoneInput: {
    flex: 2,
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginLeft: 10,
    fontSize: 16,
  },
});

export default SignupStepFour;
