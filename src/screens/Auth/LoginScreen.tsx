// Production-ready: keyboard-safe, brand styled, trimmed input, safe Quick Unlock guards,
// robust error mapping, reset password, optional magic-link sign-in.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Platform,
  ScrollView,
  AppState,
  AppStateStatus,
  InteractionManager,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import { AuthApiError } from '@supabase/supabase-js';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

// Quick Unlock (service implements native safety + kill switch)
import {
  BIO_DISABLED,
  isBiometricAvailable as deviceSupportsBiometrics,
  isQuickUnlockEnabled,
  enableQuickUnlockFromCurrentSession,
  promptQuickUnlock,
  tryPromptIfArmed,
} from '@services/QuickUnlockService';

const hasAnySocialHandle = (p: any) =>
  Boolean(p?.social_handle || p?.instagram_handle || p?.tiktok_handle || p?.facebook_handle);

const getNextIncompleteStep = (profile: any): string | null => {
  if (profile?.onboarding_complete) return null;

  if (!profile?.birthdate) return 'ProfileSetupStepTwo';
  if (!profile?.first_name || !profile?.screenname) return 'ProfileSetupStepThree';
  if (!profile?.phone) return 'ProfileSetupStepFour';
  if (!profile?.gender) return 'ProfileSetupStepFive';

  const prefs = profile?.preferences;
  if (!Array.isArray(prefs) || prefs.length === 0) return 'ProfileSetupStepSix';
  if (!profile?.agreed_to_terms) return 'ProfileSetupStepSeven';

  // Step 8 optional unless user has no socials at all
  if (!hasAnySocialHandle(profile)) return 'ProfileSetupStepEight';

  if (!profile?.location) return 'ProfileSetupStepNine';
  const gallery = profile?.gallery_photos;
  if (!profile?.profile_photo || !Array.isArray(gallery) || gallery.length < 3) return 'ProfileSetupStepTen';

  return null;
};

const isEmailValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

const LoginScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Busy state to prevent double-submits
  const [busy, setBusy] = useState(false);

  // Quick Unlock
  const [supportsQuick, setSupportsQuick] = useState(false);
  const [quickEnabled, setQuickEnabled] = useState(false);
  const promptedRef = useRef(false);

  // refs for focusing
  const emailRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);

  const emailTrimmed = email.trim().toLowerCase();
  const formValid = isEmailValid(emailTrimmed) && password.length > 0;

  // Debug: log which Supabase project this build points at (ENV mismatches cause invalid-credentials)
  useEffect(() => {
    // @ts-expect-error – not public API; safe for debug
    const debugUrl: string | undefined = (supabase as any)?.rest?.url || (supabase as any)?.supabaseUrl;
    console.log('[Auth] Using Supabase URL:', debugUrl || '(unknown)');
  }, []);

  // Route after successful auth
  const routeAfterAuth = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) {
      Alert.alert('No Active Session', 'Please log in once to enable Quick Unlock on this device.');
      return;
    }

    let { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (pErr || !profile) {
      await supabase.from('profiles').upsert({ id: userId });
      profile = { id: userId };
    }

    if (profile.onboarding_complete) {
      navigation.reset({ index: 0, routes: [{ name: 'App' as any }] });
    } else {
      const next = getNextIncompleteStep(profile);
      navigation.reset({ index: 0, routes: [{ name: (next || 'App') as any }] });
    }
  }, [navigation]);

  // Capability + preference bootstrap (deferred; iOS 18 friendly)
  useEffect(() => {
    if (BIO_DISABLED) {
      setSupportsQuick(false);
      setQuickEnabled(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      await new Promise<void>((resolve) =>
        InteractionManager.runAfterInteractions(() => resolve())
      );
      await new Promise<void>((r) => setTimeout(r, 150));
      if (cancelled) return;

      const supported = await deviceSupportsBiometrics();
      const enabled = await isQuickUnlockEnabled();
      if (!cancelled) {
        setSupportsQuick(supported);
        setQuickEnabled(enabled);
      }
    };

    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') run();
    });

    if (AppState.currentState === 'active') run();

    return () => {
      cancelled = true;
      try { sub.remove(); } catch {}
    };
  }, []);

  // Auto prompt if armed
  useEffect(() => {
    if (BIO_DISABLED || !supportsQuick || !quickEnabled || promptedRef.current) return;

    let cancelled = false;

    const maybePrompt = async () => {
      await new Promise<void>((resolve) =>
        InteractionManager.runAfterInteractions(() => resolve())
      );
      await new Promise<void>((r) => setTimeout(r, 150));
      if (cancelled || promptedRef.current) return;

      const ok = await tryPromptIfArmed(async () => {});
      if (ok) {
        promptedRef.current = true;
        await routeAfterAuth();
      }
    };

    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') maybePrompt();
    });

    if (AppState.currentState === 'active') maybePrompt();

    return () => {
      cancelled = true;
      try { sub.remove(); } catch {}
    };
  }, [supportsQuick, quickEnabled, routeAfterAuth]);

  const mapAuthError = (err: unknown): { title: string; msg: string } => {
    const def = { title: 'Login Error', msg: 'Something went wrong during login.' };
    if (!err) return def;

    const anyErr = err as any;
    const raw = (anyErr?.message || '').toString();
    const msg = raw.toLowerCase();

    // Supabase-specific errors
    if (anyErr instanceof AuthApiError) {
      if (anyErr.status === 429) return { title: 'Too Many Attempts', msg: 'Please wait a moment and try again.' };
      if (anyErr.status === 400 && msg.includes('invalid login credentials')) {
        return {
          title: 'Login Failed',
          msg: 'Invalid email or password, or the account does not exist in this environment.',
        };
      }
      if (msg.includes('email not confirmed')) {
        return { title: 'Email Not Verified', msg: 'Please verify your email before continuing.' };
      }
      return { title: 'Auth Error', msg: raw || def.msg };
    }

    // Network / fetch errors
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
      return { title: 'Network Error', msg: 'Please check your connection and try again.' };
    }

    // Fallback
    return { title: 'Login Error', msg: raw || def.msg };
  };

  const handleLogin = async () => {
    if (!formValid || busy) {
      if (!formValid) Alert.alert('Invalid input', 'Please enter a valid email and password.');
      return;
    }

    try {
      setBusy(true);
      Keyboard.dismiss();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailTrimmed,
        password,
      });

      if (error) {
        console.warn('[Auth] signInWithPassword error:', error);
        const { title, msg } = mapAuthError(error);
        Alert.alert(title, msg);
        return;
      }

      // If your project requires email confirmation before session issuance,
      // Supabase may still return a user without a confirmed email.
      if (!data?.user?.email_confirmed_at) {
        Alert.alert('Email Not Verified', 'Please verify your email before continuing.');
        return;
      }

      // Arm Quick Unlock from the live session
      try {
        if (!BIO_DISABLED) {
          await enableQuickUnlockFromCurrentSession();
          setQuickEnabled(true);
        }
      } catch (e) {
        console.warn('[QuickUnlock] enable-from-session failed', e);
      }

      await routeAfterAuth();
    } catch (e) {
      console.error('[Login Error]', e);
      const { title, msg } = mapAuthError(e);
      Alert.alert(title, msg);
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!isEmailValid(emailTrimmed)) {
      Alert.alert('Enter your email', 'Please enter the email you registered with, then try again.');
      return;
    }
    try {
      setBusy(true);
      // IMPORTANT: set your auth redirect in Supabase Auth settings to a deep link you handle
      await supabase.auth.resetPasswordForEmail(emailTrimmed, {
        redirectTo: 'dr-ynks://password-reset',
      });
      Alert.alert('Check your email', 'We sent you a password reset link.');
    } catch (e) {
      console.error('[Reset Password Error]', e);
      const { title, msg } = mapAuthError(e);
      Alert.alert(title, msg);
    } finally {
      setBusy(false);
    }
  };

  // Optional: Magic link sign-in if you want a no-password fallback
  const handleMagicLink = async () => {
    if (!isEmailValid(emailTrimmed)) {
      Alert.alert('Enter your email', 'Please enter a valid email address.');
      return;
    }
    try {
      setBusy(true);
      await supabase.auth.signInWithOtp({
        email: emailTrimmed,
        options: { emailRedirectTo: 'dr-ynks://auth-callback', shouldCreateUser: false },
      });
      Alert.alert('Check your email', 'We sent you a sign-in link.');
    } catch (e) {
      console.error('[Magic Link Error]', e);
      const { title, msg } = mapAuthError(e);
      Alert.alert(title, msg);
    } finally {
      setBusy(false);
    }
  };

  const handleQuickUnlockPress = async () => {
    try {
      if (BIO_DISABLED) {
        Alert.alert('Quick Unlock Unavailable', 'Quick Unlock is disabled for this build.');
        return;
      }
      const ok = await promptQuickUnlock();
      if (ok) await routeAfterAuth();
      else Alert.alert('Quick Unlock Unavailable', 'Log in once on this device to enable Quick Unlock.');
    } catch (e) {
      console.error('[QuickUnlock] error', e);
      Alert.alert('Error', 'Quick Unlock failed.');
    }
  };

  return (
    <AnimatedScreenWrapper>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            style={{ flex: 1, backgroundColor: DRYNKS_WHITE }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <View style={styles.container}>
              <Text style={styles.title}>
                Your Plus-One for Yacht Parties, Concerts & the Unexpected.
              </Text>

              {supportsQuick && quickEnabled ? (
                <TouchableOpacity style={[styles.quickBtn, { marginBottom: 16 }]} onPress={handleQuickUnlockPress} disabled={busy}>
                  <Ionicons name="lock-open-outline" size={18} color={DRYNKS_WHITE} />
                  <Text style={styles.quickBtnText}>Use Face ID / Passcode</Text>
                </TouchableOpacity>
              ) : null}

              <TextInput
                ref={emailRef}
                style={[styles.input, email.length > 0 && !isEmailValid(emailTrimmed) ? styles.inputError : null]}
                placeholder="Email"
                placeholderTextColor="#999"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={() => passRef.current?.focus()}
                blurOnSubmit={false}
              />

              <View style={styles.passwordWrapper}>
                <TextInput
                  ref={passRef}
                  style={styles.passwordInput}
                  placeholder="Password"
                  placeholderTextColor="#999"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="go"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity style={styles.eyeIcon} onPress={() => setShowPassword((s) => !s)}>
                  <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color="#888" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.button, (!formValid || busy) ? styles.buttonDisabled : null]}
                onPress={handleLogin}
                disabled={!formValid || busy}
                activeOpacity={0.9}
              >
                {busy ? <ActivityIndicator color={DRYNKS_WHITE} /> : <Text style={styles.buttonText}>Login</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={handleForgotPassword} disabled={busy}>
                <Text style={styles.linkText}>Forgot Password?</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleMagicLink} disabled={busy}>
                <Text style={styles.linkText}>Email me a sign‑in link</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => navigation.navigate('ProfileSetupStepOne' as any)} disabled={busy}>
                <Text style={styles.signupText}>
                  Don&apos;t have an account? <Text style={styles.signupHighlight}>Sign up</Text>
                </Text>
              </TouchableOpacity>

              <View style={{ height: 24 }} />
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  container: {
    backgroundColor: DRYNKS_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
    textAlign: 'center',
    color: DRYNKS_BLUE,
    paddingHorizontal: 10,
  },
  input: {
    width: '100%',
    height: 50,
    borderColor: '#D1D9E0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 15,
    backgroundColor: DRYNKS_GRAY,
    color: '#111',
  },
  inputError: {
    borderColor: '#F04438',
  },
  passwordWrapper: {
    width: '100%',
    position: 'relative',
    marginBottom: 15,
  },
  passwordInput: {
    width: '100%',
    height: 50,
    borderColor: '#D1D9E0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: DRYNKS_GRAY,
    paddingRight: 40,
    color: '#111',
  },
  eyeIcon: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: DRYNKS_RED,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: DRYNKS_RED,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: DRYNKS_WHITE,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  linkText: {
    color: DRYNKS_BLUE,
    marginBottom: 10,
  },
  signupText: {
    color: DRYNKS_BLUE,
    marginTop: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  signupHighlight: {
    color: DRYNKS_RED,
    fontWeight: '700',
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DRYNKS_BLUE,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  quickBtnText: {
    color: DRYNKS_WHITE,
    fontWeight: '700',
    marginLeft: 8,
  },
});

export default LoginScreen;
