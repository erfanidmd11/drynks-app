// src/screens/Onboarding/SignupStepOne.tsx
// Step 1 — Email + Password (brand styled, production safe)
// - Strong validation and clear UX for common errors
// - Persists draft locally so OTP screen can prefill
// - Attempts to create a minimal profile row if a session already exists
//   (use the same ensureProfileRow() after OTP success too)

import React, { useEffect, useMemo, useState } from 'react';
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
import { loadDraft, saveDraft } from '@utils/onboardingDraft';
// Optional but recommended: handles stale/invalid refresh tokens gracefully
import { resetAuthLocal } from '@utils/resetAuth';

// ---- Brand colors (declare ONCE) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#D9DEE3';
const DRYNKS_WHITE = '#FFFFFF';

type Nav = ReturnType<typeof useNavigation>;

// ---------- Helpers ----------
function validatePassword(pw: string) {
  return {
    length: pw.length >= 9,
    uppercase: /[A-Z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}
const isEmailValid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/**
 * Generate a deterministic fallback screenname from email + uid.
 * This guarantees we satisfy NOT NULL on profiles.screenname even
 * before the user customizes it in later steps.
 */
function genScreenname(email?: string | null, uid?: string) {
  const base = (email?.split('@')[0] || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  const suffix = (uid || Math.random().toString(36)).replace(/-/g, '').slice(0, 6);
  return `${base}_${suffix}`;
}

/**
 * Try to ensure a minimal profiles row exists for the current session's user.
 * This is safe/idempotent and respects RLS (requires a logged-in session).
 *
 * Call this here (if a session already exists) and again immediately after OTP verification.
 */
async function ensureProfileRow() {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const session = sess?.session;
    if (!session) return; // No session yet (likely email confirmation required)

    const { user } = session;
    const { data: existing, error: selErr } = await supabase
      .from('profiles')
      .select('id, screenname')
      .eq('id', user.id)
      .maybeSingle();

    if (selErr) {
      // Permission errors or transient issues—don’t block signup flow.
      console.log('[SignupStepOne] ensureProfileRow select error:', selErr);
      return;
    }
    if (existing) return; // Row already there—nothing to do.

    const fallback = genScreenname(user.email, user.id);

    const { error: insErr } = await supabase.from('profiles').insert({
      id: user.id,
      screenname: fallback,
      first_name: fallback, // temporary; user can change later
      email: user.email,
      agreed_to_terms: false,
      has_completed_profile: false,
      onboarding_complete: false,
    });

    if (insErr) {
      // Ignore duplicate insert or permission errors; the later steps will try again.
      console.log('[SignupStepOne] ensureProfileRow insert error:', insErr);
    }
  } catch (e) {
    console.log('[SignupStepOne] ensureProfileRow generic error:', e);
  }
}

const SignupStepOne: React.FC = () => {
  const navigation: Nav = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Hydrate any local draft on mount
  useEffect(() => {
    (async () => {
      try {
        const draft = await loadDraft();
        if (draft?.email) setEmail(draft.email);
        if (draft?.password) setPassword(draft.password);
      } catch {}
    })();
  }, []);

  // Persist draft when fields change (fire-and-forget)
  useEffect(() => {
    saveDraft({ email, password, step: 'EnterOtpScreen' }).catch(() => {});
  }, [email, password]);

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

      // Clear any stale local session (prevents "Invalid Refresh Token" noise on dev devices)
      await resetAuthLocal().catch(() => {});

      // Sign up (email confirmation may be required depending on your Supabase project settings)
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // If you deep-link confirmation emails back to the app, set this:
        // options: { emailRedirectTo: 'dr-ynks://auth-callback' },
      });

      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('registered') || msg.includes('exists') || msg.includes('already')) {
          Alert.alert(
            'Email already in use',
            'This email is already registered. Log in or use a different email.',
            [
              { text: 'Use a different email' },
              {
                text: 'Log in',
                onPress: () => {
                  // @ts-ignore
                  navigation.navigate('Login');
                },
              },
            ]
          );
          return;
        }
        if (msg.includes('password')) {
          Alert.alert('Weak password', 'Please choose a stronger password and try again.');
          return;
        }
        Alert.alert('Signup error', error.message);
        return;
      }

      // Try to create the minimal profile row if we already have a session.
      // If email confirmation is required, there will be no session yet—this is fine.
      await ensureProfileRow();

      // Save draft + creds so OTP screen can prefill & user can resume on this device
      await saveDraft({ email: email.trim(), password, step: 'EnterOtpScreen' });
      await saveCredentials(email.trim(), password);

      // Navigate to OTP entry (user is NOT authenticated yet if email confirmation is on)
      // @ts-ignore – params are flexible
      navigation.navigate('EnterOtpScreen', { email: email.trim() });
    } catch (e: any) {
      console.error('[SignupStepOne] Unexpected error:', e);
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
