// src/screens/Onboarding/SignupStepSix.tsx
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
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

const options = ['Male', 'Female', 'TS'] as const;

const SignupStepSix = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { screenname, first_name, phone } = route.params ?? {};

  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);

  // ---------- Hydrate from server first, then local draft ----------
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
            .select('preferences')
            .eq('id', uid)
            .maybeSingle();

          if (Array.isArray(prof?.preferences)) {
            setSelectedPrefs(prof!.preferences as string[]);
          }
        }

        if (selectedPrefs.length === 0) {
          const draft = await loadDraft();
          if (Array.isArray(draft?.preferences) && draft.preferences.length > 0) {
            setSelectedPrefs(draft.preferences as string[]);
          }
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
      preferences: selectedPrefs.length ? selectedPrefs : undefined,
      step: 'ProfileSetupStepSix',
    }).catch(() => {});
  }, [selectedPrefs, hydrated]);

  // ---------- Handlers ----------
  const toggleSelection = (value: string) => {
    setSelectedPrefs(prev =>
      prev.includes(value) ? prev.filter(p => p !== value) : [...prev, value]
    );
  };

  const handleBack = async () => {
    try {
      await saveDraft({
        preferences: selectedPrefs.length ? selectedPrefs : undefined,
        step: 'ProfileSetupStepFive',
      });

      if (me?.id) {
        await supabase
          .from('profiles')
          .update({
            preferences: selectedPrefs.length ? selectedPrefs : null,
            current_step: 'ProfileSetupStepFive',
          })
          .eq('id', me.id);
      }
    } catch {}
    navigation.goBack();
  };

  const handleNext = async () => {
    if (selectedPrefs.length === 0) {
      Alert.alert('Hold Up!', `Pick at least one preference${screenname ? `, @${screenname}` : ''}`);
      return;
    }

    try {
      const { data: u, error: ue } = await supabase.auth.getUser();
      if (ue || !u?.user?.id || !u.user.email) {
        Alert.alert('Error', 'User not authenticated.');
        return;
      }
      const uid = u.user.id;
      const email = u.user.email;

      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: uid,
        email,
        screenname: screenname ?? null,
        first_name: first_name ?? null,
        phone: phone ?? null,
        preferences: selectedPrefs,
        current_step: 'ProfileSetupStepSeven', // advance to Step 7 (Orientation)
      });

      if (upsertError) {
        console.error('[Supabase Upsert Error]', upsertError);
        Alert.alert('Error', 'Could not save your preferences.');
        return;
      }

      await saveDraft({ preferences: selectedPrefs, step: 'ProfileSetupStepSeven' });

      navigation.navigate('ProfileSetupStepSeven' as never, {
        screenname,
        first_name,
        phone,
      } as never);
    } catch (err) {
      console.error('[SignupStepSix Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  // ---------- UI ----------
  const disabled = selectedPrefs.length === 0;

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
              {screenname ? `Who are you into, @${screenname}? 💖` : 'Who are you into? 💖'}
            </Text>

            <View style={styles.optionsWrapper}>
              {options.map(option => {
                const isSelected = selectedPrefs.includes(option);
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.optionButton, isSelected && styles.optionButtonSelected]}
                    onPress={() => toggleSelection(option)}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                      {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ marginTop: 40 }}>
              <OnboardingNavButtons
                onBack={handleBack}
                onNext={handleNext}
                {...({ disabled } as any)}
              />
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
    paddingBottom: 24,
    backgroundColor: DRYNKS_WHITE,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 30,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  optionsWrapper: {
    gap: 15,
  },
  optionButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    backgroundColor: DRYNKS_GRAY,
    borderRadius: 10,
    borderColor: '#DADFE6',
    borderWidth: 1,
    marginBottom: 6,
  },
  optionButtonSelected: {
    backgroundColor: DRYNKS_RED,
    borderColor: DRYNKS_RED,
  },
  optionText: {
    fontSize: 18,
    textAlign: 'center',
    color: '#23303A',
  },
  optionTextSelected: {
    color: DRYNKS_WHITE,
    fontWeight: '700',
  },
});

export default SignupStepSix;
