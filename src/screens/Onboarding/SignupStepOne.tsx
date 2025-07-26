import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { saveCredentials } from '@utils/secureStore';

const SignupStepOne = () => {
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validatePassword = (password) => ({
    length: password.length >= 9,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  });

  const isEmailValid = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleNext = async () => {
    const checks = validatePassword(password);
    const validPassword = Object.values(checks).every(Boolean);

    if (!email || !password || !validPassword || !isEmailValid(email)) {
      Alert.alert(
        'Hold Up!',
        'Make sure your email is valid and password meets all the requirements.'
      );
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: null,
          channel: 'email_otp',
        },
      });

      if (error) {
        Alert.alert('Signup Error', error.message);
        return;
      }

      const user = data?.user;
      if (user?.id) {
        // ✅ Safe early upsert
        await supabase.from('profiles').upsert({
          id: user.id,
          email: user.email,
          current_step: 'ProfileSetupStepOne',
          created_at: new Date().toISOString(),
        });
      }

      await saveCredentials(email, password);
      navigation.navigate('EnterOtpScreen', { email, password });
    } catch (err) {
      console.error('[Signup Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const passwordChecks = validatePassword(password);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <Image
            source={require('@assets/images/DrYnks_Y_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text style={styles.tagline}>
            Your Plus-One for Yacht Parties, Concerts & the Unexpected.
          </Text>

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

          <View style={styles.passwordContainer}>
            <TextInput
              style={[styles.input, { flex: 1, borderWidth: 0, marginBottom: 0 }]}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              placeholderTextColor="#999"
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Text style={styles.toggle}>
                {showPassword ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
          </View>

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

          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleNext}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.continueText}>Continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
            <Text style={styles.loginLink}>
              Already have an account?{' '}
              <Text style={styles.loginHighlight}>Log in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  logo: {
    width: 80,
    height: 80,
    alignSelf: 'center',
    marginBottom: 20,
  },
  tagline: {
    textAlign: 'center',
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    paddingHorizontal: 10,
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
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 15,
    height: 50,
  },
  toggle: {
    color: '#007AFF',
    fontWeight: '600',
    marginLeft: 10,
  },
  checklist: {
    marginBottom: 20,
  },
  continueButton: {
    backgroundColor: '#ff5a5f',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  continueText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loginLink: {
    textAlign: 'center',
    fontSize: 14,
    color: '#555',
  },
  loginHighlight: {
    color: '#007AFF',
    fontWeight: '600',
  },
});

export default SignupStepOne;
