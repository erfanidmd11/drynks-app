// src/screens/Onboarding/SignupStepFive.tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
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

const genderOptions = ['Male', 'Female', 'TS'] as const;

const SignupStepFive = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { screenname, first_name, phone } = route.params ?? {};

  const [gender, setGender] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);

  // ---- Hydrate from server (cross-device) then local draft (cache) ----
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
            .select('gender')
            .eq('id', uid)
            .maybeSingle();

          if (prof?.gender) setGender(String(prof.gender));
        }

        if (!gender) {
          const draft = await loadDraft();
          if (draft?.gender) setGender(String(draft.gender));
        }
      } catch {
        // ignore
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Persist draft whenever selection changes ----
  useEffect(() => {
    if (!hydrated) return;
    saveDraft({ gender: gender || undefined, step: 'ProfileSetupStepFive' }).catch(() => {});
  }, [gender, hydrated]);

  // ---- Handlers ----
  const handleBack = async () => {
    try {
      await saveDraft({ gender: gender || undefined, step: 'ProfileSetupStepFour' });
      if (me?.id) {
        await supabase
          .from('profiles')
          .update({
            gender: gender || null,
            current_step: 'ProfileSetupStepFour',
          })
          .eq('id', me.id);
      }
    } catch {}
    navigation.goBack();
  };

  const handleNext = async () => {
    if (!gender) {
      Alert.alert('Required', 'Please select your gender.');
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
        gender,
        current_step: 'ProfileSetupStepSix', // advance to next step
      });

      if (upsertError) {
        console.error('[Supabase Upsert Error]', upsertError);
        Alert.alert('Error', 'Could not save your selection.');
        return;
      }

      await saveDraft({ gender, step: 'ProfileSetupStepSix' });

      navigation.navigate('ProfileSetupStepSix' as never, {
        screenname,
        first_name,
        phone,
      } as never);
    } catch (err) {
      console.error('[SignupStepFive Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  // ---- UI ----
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
              {screenname ? `Hey @${screenname}, how do you identify? 🙂` : 'How do you identify? 🙂'}
            </Text>

            <View style={styles.optionsWrapper}>
              {genderOptions.map(option => (
                <TouchableOpacity
                  key={option}
                  onPress={() => setGender(option)}
                  style={[
                    styles.optionButton,
                    gender === option && styles.optionButtonSelected,
                  ]}
                  activeOpacity={0.9}
                >
                  <Text
                    style={[
                      styles.optionText,
                      gender === option && styles.optionTextSelected,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 40 }}>
              <OnboardingNavButtons
                onBack={handleBack}
                onNext={handleNext}
                {...({ disabled: !gender } as any)}
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
    flexDirection: 'column',
    gap: 15,
  },
  optionButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    backgroundColor: DRYNKS_GRAY,
    borderRadius: 10,
    borderColor: '#DADFE6',
    borderWidth: 1,
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

export default SignupStepFive;
