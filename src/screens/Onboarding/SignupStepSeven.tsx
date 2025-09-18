// src/screens/Onboarding/SignupStepSeven.tsx
// Step 7 — Orientation (server-first hydrate, draft cache, Next/Back persistence)

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';
import { loadDraft, saveDraft } from '@utils/onboardingDraft';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';
const DRYNKS_GRAY = '#F1F4F7';

const orientations = ['Straight', 'Gay/Lesbian', 'Bisexual', 'Pansexual', 'Everyone'] as const;

type RouteParams = {
  screenname?: string | null;
  first_name?: string | null;
  phone?: string | null;
};

const SignupStepSeven: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { screenname, first_name, phone } = (route?.params || {}) as RouteParams;

  const [selected, setSelected] = useState<typeof orientations[number] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);

  // ---------- Hydrate from server first (cross-device), then local draft ----------
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
            .select('orientation')
            .eq('id', uid)
            .maybeSingle();

          if (prof?.orientation) setSelected(prof.orientation as any);
        }

        if (!selected) {
          const draft = await loadDraft();
          if (draft?.orientation) setSelected(draft.orientation as any);
        }
      } catch {
        // ignore
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Persist draft whenever selection changes ----------
  useEffect(() => {
    if (!hydrated) return;
    saveDraft({
      orientation: selected ?? undefined,
      step: 'ProfileSetupStepSeven',
    }).catch(() => {});
  }, [selected, hydrated]);

  // ---------- Handlers ----------
  const handleBack = async () => {
    try {
      await saveDraft({
        orientation: selected ?? undefined,
        step: 'ProfileSetupStepSix',
      });

      if (me?.id) {
        await supabase
          .from('profiles')
          .update({
            orientation: selected ?? null,
            current_step: 'ProfileSetupStepSix',
          })
          .eq('id', me.id);
      }
    } catch {}
    navigation.goBack();
  };

  const handleNext = async () => {
    if (!selected) {
      Alert.alert('Missing Selection', 'Select your sexual orientation to continue.');
      return;
    }

    try {
      setSaving(true);
      const { data: u, error: ue } = await supabase.auth.getUser();
      if (ue || !u?.user?.id || !u.user.email) {
        Alert.alert('Session Error', 'Please log in again.');
        return;
      }

      const uid = u.user.id;
      const email = u.user.email;

      const { error: upErr } = await supabase
        .from('profiles')
        .upsert({
          id: uid,
          email,
          screenname: screenname ?? null,
          first_name: first_name ?? null,
          phone: phone ?? null,
          orientation: selected,
          current_step: 'ProfileSetupStepEight', // advance to Step 8 (Social handles)
        });

      if (upErr) {
        console.error('[Step7 upsert error]', upErr);
        Alert.alert('Error', upErr.message || 'Could not save orientation.');
        return;
      }

      await saveDraft({ orientation: selected, step: 'ProfileSetupStepEight' });

      navigation.navigate('ProfileSetupStepEight' as never, {
        screenname,
        first_name,
        phone,
      } as never);
    } catch (err: any) {
      console.error('[SignupStepSeven] submit error', err);
      Alert.alert('Error', err?.message || 'Could not continue.');
    } finally {
      setSaving(false);
    }
  };

  // ---------- UI ----------
  const disabled = !selected || saving;

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Math.max(0, insets.top + 64)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="always"
          >
            <Text style={styles.header}>
              {screenname ? `What’s your orientation, @${screenname}? 🌈` : 'What’s your orientation? 🌈'}
            </Text>
            <Text style={styles.subtext}>
              Choose the option that best describes you.
            </Text>

            <View style={styles.optionsWrapper}>
              {orientations.map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.option, selected === opt && styles.optionSelected]}
                  onPress={() => setSelected(opt)}
                  activeOpacity={0.9}
                  disabled={saving}
                >
                  <Text style={[styles.optionText, selected === opt && styles.optionTextSelected]}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 24 }}>
              <OnboardingNavButtons
                onBack={handleBack}
                onNext={handleNext}
                {...({
                  nextLabel: saving ? 'Saving…' : 'Next',
                  disabled,
                } as any)}
              />
              {saving && (
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
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 40,
    backgroundColor: DRYNKS_WHITE,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  subtext: {
    fontSize: 14,
    color: '#55606B',
    textAlign: 'center',
    marginBottom: 18,
  },
  optionsWrapper: {
    gap: 12,
    marginBottom: 8,
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: DRYNKS_GRAY,
    borderColor: '#DADFE6',
    borderWidth: 1,
  },
  optionSelected: {
    backgroundColor: DRYNKS_RED,
    borderColor: DRYNKS_RED,
  },
  optionText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#23303A',
  },
  optionTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default SignupStepSeven;
