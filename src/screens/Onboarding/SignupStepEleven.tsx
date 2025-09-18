// src/screens/Auth/SignupStepEleven.tsx
// src/screens/Onboarding/SignupStepEleven.tsx
// Step 11 — Terms (finalize): hydrate, draft cache, accept terms, mark complete, quick unlock, route to App.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform,
  ScrollView, TouchableWithoutFeedback, Keyboard, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';
import { supabase } from '@config/supabase';
import { loadDraft, saveDraft, clearDraft } from '@utils/onboardingDraft';

import {
  enableQuickUnlock,       // stores refresh token securely
  isBiometricAvailable as deviceSupportsBiometrics,
} from '@services/QuickUnlockService';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';
const DRYNKS_GRAY = '#F1F4F7';

// You can bump this to invalidate old consent text later
const TERMS_VERSION = 'v1';

type RouteParams = {
  screenname?: string | null;
  first_name?: string | null;
  phone?: string | null;
};

const SignupStepEleven: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { screenname } = (route?.params || {}) as RouteParams;

  const [accepted, setAccepted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);
  const pressedRef = useRef(false);

  // -------- Hydrate from server, then draft --------
  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id || null;
        const email = u?.user?.email || null;
        if (uid && email) setMe({ id: uid, email });

        if (uid) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('agreed_to_terms, accepted_terms_at, accepted_terms_version')
            .eq('id', uid)
            .maybeSingle();

          if (prof?.agreed_to_terms) setAccepted(true);
        }

        if (!accepted) {
          const draft = await loadDraft();
          if (typeof draft?.agreed_to_terms === 'boolean') setAccepted(draft.agreed_to_terms as boolean);
        }
      } catch {
        // ignore, user can still toggle
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Persist draft on change --------
  useEffect(() => {
    if (!hydrated) return;
    saveDraft({ agreed_to_terms: accepted, step: 'ProfileSetupStepEleven' }).catch(() => {});
  }, [accepted, hydrated]);

  // -------- Handlers --------
  const handleBack = async () => {
    try {
      await saveDraft({ agreed_to_terms: accepted, step: 'ProfileSetupStepTen' });
      if (me?.id) {
        await supabase
          .from('profiles')
          .update({
            agreed_to_terms: accepted,
            current_step: 'ProfileSetupStepTen', // back to Photos
          })
          .eq('id', me.id);
      }
    } catch {}
    navigation.goBack();
  };

  const handleFinish = async () => {
    if (pressedRef.current) return;
    pressedRef.current = true;

    try {
      if (!accepted) {
        Alert.alert('Almost there!', 'Please accept the Terms of Use and Privacy Policy to continue.');
        return;
      }

      setSaving(true);

      const { data: u, error: ue } = await supabase.auth.getUser();
      if (ue || !u?.user?.id || !u.user.email) {
        Alert.alert('Session Error', 'Please log in again.');
        return;
      }
      const uid = u.user.id;

      // 1) Save terms + mark complete
      const { error: upErr } = await supabase
        .from('profiles')
        .update({
          agreed_to_terms: true,
          accepted_terms_at: new Date().toISOString(),
          accepted_terms_version: TERMS_VERSION,
          onboarding_complete: true,
          has_completed_profile: true,
          current_step: 'Complete',
        })
        .eq('id', uid);

      if (upErr) throw new Error(upErr.message || 'Could not save terms.');

      // 2) Optional: arm Quick Unlock
      try {
        const supported = await deviceSupportsBiometrics();
        if (supported) {
          const { data: s } = await supabase.auth.getSession();
          const refreshToken = s?.session?.refresh_token;
          if (refreshToken) await enableQuickUnlock(refreshToken);
        }
      } catch (e) {
        // Non-fatal
        console.warn('[Step11] enableQuickUnlock failed:', e);
      }

      // 3) Clear local onboarding scratch
      try {
        await clearDraft();
      } catch (e) {
        console.warn('[Step11] clearDraft failed:', e);
      }

      // 4) Route to the main app
      navigation.reset({ index: 0, routes: [{ name: 'App' }] });
    } catch (err: any) {
      console.error('[SignupStepEleven] submit error', err);
      Alert.alert('Error', err?.message || 'Could not finish signup.');
    } finally {
      setSaving(false);
      pressedRef.current = false;
    }
  };

  // -------- UI --------
  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Math.max(0, insets.top + 64)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
            <Text style={styles.header}>
              {screenname ? `The Fine Print, @${screenname} 📜` : 'The Fine Print 📜'}
            </Text>
            <Text style={styles.subtext}>
              By using DrYnks, you agree to our Terms of Use and Privacy Policy. It helps keep the vibe safe,
              respectful, and spam-free.
            </Text>

            <View style={styles.termsBox}>
              <Text style={styles.termsText}>
                • You must be 18+ to use DrYnks.{'\n'}
                • Respect all users — no harassment or hate speech.{'\n'}
                • No spamming or fake profiles.{'\n'}
                • We value your privacy. We don’t sell your data.
              </Text>
            </View>

            <TouchableOpacity onPress={() => setAccepted(!accepted)} style={styles.acceptRow} activeOpacity={0.9}>
              <Text style={styles.checkbox}>{accepted ? '☑' : '☐'}</Text>
              <Text style={styles.acceptText}>I agree to the Terms of Use and Privacy Policy</Text>
            </TouchableOpacity>

            <OnboardingNavButtons
              onBack={handleBack}
              onNext={handleFinish}
              {...({ nextLabel: saving ? 'Saving…' : 'Finish', disabled: saving || !accepted } as any)}
            />

            {saving && (
              <View style={{ marginTop: 10, alignItems: 'center' }}>
                <ActivityIndicator />
              </View>
            )}
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  inner: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    backgroundColor: DRYNKS_WHITE,
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  subtext: {
    fontSize: 14,
    color: '#55606B',
    textAlign: 'center',
    marginBottom: 16,
  },
  termsBox: {
    maxHeight: 200,
    marginBottom: 20,
    padding: 12,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: DRYNKS_GRAY,
  },
  termsText: {
    fontSize: 14,
    color: '#23303A',
    lineHeight: 20,
  },
  acceptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    justifyContent: 'center',
  },
  checkbox: {
    fontSize: 20,
    marginRight: 10,
    color: DRYNKS_BLUE,
  },
  acceptText: {
    fontSize: 14,
    color: '#23303A',
  },
});

export default SignupStepEleven;
