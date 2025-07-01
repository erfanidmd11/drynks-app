// SignupStepOne.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const SignupStepOne = () => {
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const validatePassword = (password: string) => {
    return {
      length: password.length >= 9,
      uppercase: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    };
  };

  const handleNext = async () => {
    const checks = validatePassword(password);
    const valid = Object.values(checks).every(Boolean);

    if (!email || !password || !valid) {
      Alert.alert('Hold Up!', 'Make sure your password meets all the requirements.');
      return;
    }

    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      Alert.alert('Signup Error', error.message);
    } else {
      Alert.alert(
        'Check Your Inbox 📬',
        'We’ve sent a verification email to finish setting up your account. Peek in your spam folder if it’s playing hard to get.'
      );
      navigation.navigate('ProfileSetupStepTwo');
    }
  };

  const passwordChecks = validatePassword(password);

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>Create Your Account</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholderTextColor="#999"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor="#999"
        />

        <View style={styles.checklist}>
          <Text style={{ color: passwordChecks.length ? 'green' : 'red' }}>
            {passwordChecks.length ? '✔' : '✖'} At least 9 characters
          </Text>
          <Text style={{ color: passwordChecks.uppercase ? 'green' : 'red' }}>
            {passwordChecks.uppercase ? '✔' : '✖'} One uppercase letter
          </Text>
          <Text style={{ color: passwordChecks.number ? 'green' : 'red' }}>
            {passwordChecks.number ? '✔' : '✖'} One number
          </Text>
          <Text style={{ color: passwordChecks.special ? 'green' : 'red' }}>
            {passwordChecks.special ? '✔' : '✖'} One special character
          </Text>
        </View>

        <OnboardingNavButtons onNext={handleNext} showBack={false} />

        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.loginLink}>Already have an account? Log in</Text>
        </TouchableOpacity>
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
  input: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 15,
    fontSize: 16,
  },
  checklist: {
    marginBottom: 20,
  },
  loginLink: {
    textAlign: 'center',
    color: '#007bff',
    marginTop: 10,
  },
});

export default SignupStepOne;
