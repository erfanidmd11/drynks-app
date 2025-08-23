// src/screens/Auth/SignupStepEleven.tsx
// Final step: saves orientation, marks profile complete, arms Quick Unlock, clears onboarding state, and routes to App.

import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform,
  ScrollView, TouchableWithoutFeedback, Keyboard, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';
import { supabase } from '@config/supabase';

import {
  enableQuickUnlock,       // stores refresh token securely
  isBiometricAvailable as deviceSupportsBiometrics,
} from '@services/QuickUnlockService';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const orientations = ['Straight', 'Gay/Lesbian', 'Bisexual', 'Pansexual', 'Everyone'] as const;

type RouteParams = {
  userId?: string;
  screenname?: string | null;
};

const SignupStepEleven: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { userId, screenname } = (route?.params || {}) as RouteParams;

  const [selected, setSelected] = useState<typeof orientations[number] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pressedRef = useRef(false);

  const handleNext = async () => {
    if (pressedRef.current) return;
    pressedRef.current = true;

    try {
      if (!selected) {
        Alert.alert('Missing Selection', 'Select your sexual orientation to continue.');
        return;
      }
      if (!userId) {
        Alert.alert('Session Error', 'Missing user. Please log in again.');
        return;
      }

      setSubmitting(true);

      // 1) Save orientation + mark profile complete (keep both flags for backward compatibility)
      const { error: upErr } = await supabase
        .from('profiles')
        .update({
          orientation: selected,
          onboarding_complete: true,
          has_completed_profile: true, // <-- Keep this consistent with the rest of the app
        })
        .eq('id', userId);

      if (upErr) {
        throw new Error(upErr.message || 'Could not save orientation.');
      }

      // 2) Try to arm Quick Unlock right away (if the device supports it and a session exists)
      try {
        const supported = await deviceSupportsBiometrics();
        if (supported) {
          const { data: s } = await supabase.auth.getSession();
          const refreshToken = s?.session?.refresh_token;
          if (refreshToken) {
            await enableQuickUnlock(refreshToken);
          }
        }
      } catch (e) {
        // Non-fatal; user can still continue
        console.warn('[SignupStepEleven] enableQuickUnlock failed:', e);
      }

      // 3) Clear local onboarding scratch state (ignore errors)
      try {
        await AsyncStorage.multiRemove(['onboarding:wip_step', 'onboarding:wip_payload']);
      } catch (e) {
        console.warn('[SignupStepEleven] clear onboarding state failed:', e);
      }

      // 4) Reset to the app shell so header/footer tabs appear
      navigation.reset({
        index: 0,
        routes: [{ name: 'App' }],
      });
    } catch (err: any) {
      console.error('[SignupStepEleven] submit error', err);
      Alert.alert('Error', err?.message || 'Could not finish signup.');
    } finally {
      setSubmitting(false);
      pressedRef.current = false;
    }
  };

  return (
    <AnimatedScreenWrapper>
      <KeyboardAvoidingView
        style={styles.scrollContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
            <Text style={styles.header}>
              {screenname ? `Last Step, @${screenname}! 🌈` : 'Last Step! 🌈'}
            </Text>
            <Text style={styles.subtext}>Who are you into? Pick your orientation:</Text>

            {orientations.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.option, selected === opt && styles.selectedOption]}
                onPress={() => setSelected(opt)}
                disabled={submitting}
              >
                <Text style={[styles.optionText, selected === opt && styles.selectedText]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}

            <View style={{ marginTop: 20 }}>
              <OnboardingNavButtons
                onNext={handleNext}
                {...({
                  nextLabel: submitting ? 'Saving…' : 'Finish',
                  disabled: submitting || !selected,
                } as any)} // ✅ cast extra props to satisfy TS without changing component code
              />
              {submitting && (
                <View style={{ marginTop: 10, alignItems: 'center' }}>
                  <ActivityIndicator />
                </View>
              )}
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
  },
  inner: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    backgroundColor: '#fff',
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  subtext: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 20,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
    width: '100%',
    alignItems: 'center',
  },
  selectedOption: {
    backgroundColor: DRYNKS_RED,
  },
  optionText: {
    fontSize: 16,
    color: '#333',
  },
  selectedText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default SignupStepEleven;
