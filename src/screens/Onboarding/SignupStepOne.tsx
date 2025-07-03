// SignupStepOne.tsx – Production-Ready and Crash Safe
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, TouchableOpacity, Button } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
// import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper'; // Temporarily disabled
// import OnboardingNavButtons from '../../components/common/OnboardingNavButtons'; // Temporarily disabled

const SignupStepOne = () => {
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.log('[SignupStepOne] Mounted');
  }, []);

  const validatePassword = (password: string) => ({
    length: password.length >= 9,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  });

  const isEmailValid = (email: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleNext = async () => {
    const checks = validatePassword(password);
    const validPassword = Object.values(checks).every(Boolean);

    if (!email || !password || !validPassword || !isEmailValid(email)) {
      Alert.alert('Hold Up!', 'Make sure your email is valid and password meets all the requirements.');
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.auth.signUp({ email, password });

      if (error) {
        Alert.alert('Signup Error', error.message);
      } else {
        Alert.alert(
          'Check Your Inbox 📬',
          'We’ve sent a verification email to finish setting up your account. Peek in your spam folder if it’s playing hard to get.',
          [{ text: 'OK', onPress: () => navigation.navigate('ProfileSetupStepTwo') }]
        );
      }
    } catch (err) {
      console.error('[Signup Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const passwordChecks = validatePassword(password);

  return (
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

      <Button title="Continue" onPress={handleNext} disabled={loading} />

      <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
        <Text style={styles.loginLink}>Already have an account? Log in</Text>
      </TouchableOpacity>
    </View>
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
