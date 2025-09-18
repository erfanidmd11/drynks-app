// src/screens/Onboarding/SignupStepTwo.tsx
// Step 2 — Birthdate
// - Strict MM/DD/YYYY parsing (no timezone drift)
// - Age >= 18 enforcement (optional underage waitlist write)
// - Ensures a minimal profiles row exists (screenname fallback) before UPDATE
// - UPDATE only (no upsert) to prevent NOT NULL 'screenname' violations

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  Keyboard,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '@components/common/OnboardingNavButtons';
import { supabase } from '@config/supabase';
import { loadDraft, saveDraft } from '@utils/onboardingDraft';
import { useNavigationTyped } from '@utils/navigationHooks';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

// ---------- Helpers ----------
const pad2 = (n: number) => String(n).padStart(2, '0');

function genScreenname(email?: string | null, uid?: string) {
  const base = (email?.split('@')[0] || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  const suffix = (uid || Math.random().toString(36)).replace(/-/g, '').slice(0, 6);
  return `${base}_${suffix}`;
}

/**
 * Ensure a minimal profile row exists for the authenticated user.
 * Idempotent. Satisfies NOT NULL(screenname). Keep RLS policy to allow
 * insert when auth.uid() = id.
 */
async function ensureProfileRow() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return;

  const { data: existing, error: selErr } = await supabase
    .from('profiles')
    .select('id, screenname')
    .eq('id', user.id)
    .maybeSingle();

  if (selErr) {
    console.log('[SignupStepTwo] ensureProfileRow select error:', selErr);
    return;
  }
  if (existing) return;

  const fallback = genScreenname(user.email, user.id);
  const { error: insErr } = await supabase.from('profiles').insert({
    id: user.id,
    screenname: fallback,
    first_name: fallback,
    email: user.email,
    agreed_to_terms: false,
    has_completed_profile: false,
    onboarding_complete: false,
  });

  if (insErr) {
    // Don't hard-fail signup here; log and continue. Update below will still try.
    console.log('[SignupStepTwo] ensureProfileRow insert error:', insErr);
  }
}

/**
 * Format typing to MM/DD/YYYY as the user enters digits.
 */
function maskDobInput(input: string, set: (s: string) => void) {
  const digits = input.replace(/[^\d]/g, '');
  let out = '';
  if (digits.length <= 2) out = digits;
  else if (digits.length <= 4) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  else out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  set(out);
}

/**
 * Parse 'MM/DD/YYYY' (or 'M/D/YYYY') into 'YYYY-MM-DD' with real calendar checks.
 * No use of Date.toISOString() to avoid timezone rollovers.
 */
function toISODate(mmddyyyy: string): string | null {
  const m = Number(mmddyyyy.split('/')[0]);
  const d = Number(mmddyyyy.split('/')[1]);
  const y = Number(mmddyyyy.split('/')[2]);
  if (!m || !d || !y || y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;

  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d < 1 || d > daysInMonth) return null;

  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function calcAge(iso: string): number {
  const [Y, M, D] = iso.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - Y;
  const mDiff = today.getMonth() + 1 - M;
  const dDiff = today.getDate() - D;
  if (mDiff < 0 || (mDiff === 0 && dDiff < 0)) age -= 1;
  return age;
}

const SignupStepTwo: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigationTyped();

  const [dob, setDob] = useState(''); // MM/DD/YYYY
  const [hydrated, setHydrated] = useState(false);

  // -------- Hydrate from server/draft --------
  useEffect(() => {
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;

        // Server first
        if (uid) {
          const { data: prof, error } = await supabase
            .from('profiles')
            .select('birthdate')
            .eq('id', uid)
            .maybeSingle();

          if (!error && prof?.birthdate) {
            const [Y, M, D] = String(prof.birthdate).split('-');
            setDob(`${M}/${D}/${Y}`);
            setHydrated(true);
            return;
          }
        }

        // Local draft fallback
        const draft = await loadDraft();
        if (draft?.birthdate) {
          const [Y, M, D] = String(draft.birthdate).split('-');
          setDob(`${M}/${D}/${Y}`);
        }
      } catch (e) {
        console.log('[SignupStepTwo] hydrate error:', e);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Save draft on change (normalized if valid)
  useEffect(() => {
    if (!hydrated) return;
    const iso = toISODate(dob);
    saveDraft({ birthdate: iso ?? undefined, step: 'ProfileSetupStepTwo' }).catch(() => {});
  }, [dob, hydrated]);

  // -------- Handlers --------
  const handleBack = async () => {
    try {
      const iso = toISODate(dob);
      await saveDraft({ birthdate: iso ?? undefined, step: 'ProfileSetupStepOne' });

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (uid) {
        await ensureProfileRow(); // safe if row doesn't exist yet
        await supabase
          .from('profiles')
          .update({ birthdate: iso ?? null, current_step: 'ProfileSetupStepOne' })
          .eq('id', uid);
      }
    } catch (e) {
      console.log('[SignupStepTwo] back error:', e);
    }
    navigation.goBack();
  };

  const handleNext = async () => {
    const iso = toISODate(dob);
    if (!iso) {
      Alert.alert('Invalid Date', 'Please enter a valid date in MM/DD/YYYY format.');
      return;
    }

    const age = calcAge(iso);
    if (age < 18) {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const email = auth?.user?.email;
        if (email) {
          await supabase.from('waitlist_underage').insert({ email, birthdate: iso }).catch(() => {});
        }
      } catch {}
      Alert.alert(
        'Almost There 🥲',
        'DrYnks is 18+ only. We’ll save you a spot and toast you on your birthday! 🎉'
      );
      return;
    }

    try {
      const { data: auth, error: userErr } = await supabase.auth.getUser();
      if (userErr || !auth?.user?.id) {
        Alert.alert('Error', 'User not authenticated.');
        return;
      }
      const uid = auth.user.id;

      // Make sure `profiles` row exists with a screenname
      await ensureProfileRow();

      // UPDATE only — avoids NOT NULL(screenname) violations that happen with UPSERT insert
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          birthdate: iso,
          current_step: 'ProfileSetupStepThree',
        })
        .eq('id', uid);

      if (updateErr) {
        console.error('[Supabase Update Error]', updateErr);
        Alert.alert('Database Error', 'Could not save your birthdate.');
        return;
      }

      await saveDraft({ birthdate: iso, step: 'ProfileSetupStepThree' });

      navigation.navigate('ProfileSetupStepThree');
    } catch (e) {
      console.error('[SignupStepTwo] next error:', e);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Math.max(0, insets.top + 64)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <Text style={styles.header}>Your Birthday 🎂</Text>
            <Text style={styles.subtext}>Let’s make sure you’re old enough to sip on DrYnks.</Text>

            <TextInput
              style={styles.input}
              placeholder="MM/DD/YYYY"
              value={dob}
              onChangeText={(t) => maskDobInput(t, setDob)}
              keyboardType="number-pad"
              placeholderTextColor="#8A94A6"
              maxLength={10}
              returnKeyType="done"
              blurOnSubmit
            />

            <OnboardingNavButtons onNext={handleNext} onBack={handleBack} />
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
    backgroundColor: DRYNKS_WHITE,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  subtext: {
    textAlign: 'center',
    color: '#55606B',
    marginBottom: 20,
  },
  input: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 20,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
});

export default SignupStepTwo;
