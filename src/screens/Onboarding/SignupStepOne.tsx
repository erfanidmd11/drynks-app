// src/screens/Onboarding/SignupStepOne.tsx
// Step 1 — Email + Password (brand styled, production safe)

import React, { useMemo, useState } from 'react';
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
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { saveCredentials } from '@utils/secureStore';

// ---- Brand colors (declare ONCE) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#D9DEE3';
const DRYNKS_WHITE = '#FFFFFF';

type Nav = ReturnType<typeof useNavigation>;

function validatePassword(pw: string) {
  return {
    length: pw.length >= 9,
    uppercase: /[A-Z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}
const isEmailValid = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const SignupStepOne: React.FC = () => {
  const navigation: Nav = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const checks = useMemo(() => validatePassword(password), [password]);
  const passwordValid = Object.values(checks).every(Boolean);
  const emailValid = isEmailValid(email);
  const formValid = emailValid && passwordValid;

  const handleNext = async () => {
    if (!formValid) {
      Alert.alert(
        'Hold up',
        'Please enter a valid email and a strong password (9+ chars, 1 uppercase, 1 number, 1 special).'
      );
      return;
    }

    try {
      setLoading(true);

      // Supabase sign-up
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // (Optional) add profile seed via "data" if you want
        // options: { data: { source: 'app' } }
      });

      if (error) {
        Alert.alert('Signup error', error.message);
        return;
      }

      const user = data?.user;
      if (user?.id) {
        // Safe upsert of profile row so Step 2 has an id to work with
        await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            email: user.email,
            current_step: 'ProfileSetupStepOne',
            created_at: new Date().toISOString(),
          })
          .then(({ error: upsertErr }) => {
            if (upsertErr) console.warn('[profiles upsert]', upsertErr.message);
          });
      }

      await saveCredentials(email.trim(), password);

      // Pass creds to OTP screen (your flow expects it)
      // @ts-ignore – keep params flexible for now
      navigation.navigate('EnterOtpScreen', { email: email.trim(), password });
    } catch (e: any) {
      console.error('[Signup Error]', e);
      Alert.alert('Unexpected error', 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: DRYNKS_BLUE }}
    >
      <StatusBar barStyle="light-content" />
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

          <Text style={styles.header}>Create your account</Text>

          <TextInput
            style={[styles.input, !emailValid && email.length > 0 ? styles.inputError : null]}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholderTextColor="#98A4AE"
            returnKeyType="next"
          />

          <View
            style={[
              styles.passwordContainer,
              !passwordValid && password.length > 0 ? styles.inputError : null,
            ]}
          >
            <TextInput
              style={styles.passwordInput}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              placeholderTextColor="#98A4AE"
              returnKeyType="done"
            />
            <TouchableOpacity onPress={() => setShowPassword((s) => !s)}>
              <Text style={styles.toggle}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.checklist}>
            <ChecklistItem ok={checks.length} label="At least 9 characters" />
            <ChecklistItem ok={checks.uppercase} label="One uppercase letter" />
            <ChecklistItem ok={checks.number} label="One number" />
            <ChecklistItem ok={checks.special} label="One special character" />
          </View>

          <TouchableOpacity
            style={[styles.continueButton, !formValid || loading ? styles.buttonDisabled : null]}
            onPress={handleNext}
            disabled={!formValid || loading}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator color={DRYNKS_WHITE} />
            ) : (
              <Text style={styles.continueText}>Continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              // @ts-ignore
              navigation.navigate('Login');
            }}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.loginLink}>
              Already have an account? <Text style={styles.loginHighlight}>Log in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={styles.checkRow}>
      <Text style={[styles.checkIcon, { color: ok ? '#20C997' : '#F04438' }]}>
        {ok ? '✔' : '✖'}
      </Text>
      <Text style={[styles.checkText, { color: ok ? DRYNKS_WHITE : '#E8EDF2' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 48,
    paddingBottom: 24,
    backgroundColor: DRYNKS_BLUE,
    justifyContent: 'center',
  },
  logo: {
    width: 84,
    height: 84,
    alignSelf: 'center',
    marginBottom: 12,
  },
  tagline: {
    textAlign: 'center',
    fontSize: 13,
    color: '#B9C3CC',
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    color: DRYNKS_WHITE,
    textAlign: 'center',
    marginBottom: 18,
  },
  input: {
    height: 52,
    borderColor: DRYNKS_GRAY,
    backgroundColor: '#2C3944',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
    fontSize: 16,
    color: DRYNKS_WHITE,
  },
  inputError: {
    borderColor: '#F04438',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    backgroundColor: '#2C3944',
    borderColor: DRYNKS_GRAY,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    color: DRYNKS_WHITE,
    paddingVertical: 0,
  },
  toggle: {
    color: DRYNKS_RED,
    fontWeight: '700',
    marginLeft: 10,
  },
  checklist: {
    marginTop: 2,
    marginBottom: 18,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  checkIcon: {
    width: 18,
    textAlign: 'center',
    marginRight: 8,
    fontSize: 13,
  },
  checkText: {
    fontSize: 13,
  },
  continueButton: {
    backgroundColor: DRYNKS_RED,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 14,
    shadowColor: DRYNKS_RED,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  continueText: {
    color: DRYNKS_WHITE,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  loginLink: {
    textAlign: 'center',
    fontSize: 14,
    color: '#C6CFD6',
  },
  loginHighlight: {
    color: DRYNKS_WHITE,
    fontWeight: '800',
  },
});

export default SignupStepOne;
