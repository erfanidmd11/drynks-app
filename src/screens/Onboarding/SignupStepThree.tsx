// src/screens/Onboarding/SignupStepThree.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '@components/common/OnboardingNavButtons';
import { loadDraft, saveDraft } from '@utils/onboardingDraft';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

function useDebouncedCallback<T extends any[]>(fn: (...args: T) => void, delay = 300) {
  const t = useRef<NodeJS.Timeout | null>(null);
  return useCallback(
    (...args: T) => {
      if (t.current) clearTimeout(t.current);
      t.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  );
}

const SignupStepThree = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [firstName, setFirstName] = useState('');
  const [screenname, setScreenname] = useState('');
  const [checking, setChecking] = useState(false);
  const [screennameValid, setScreennameValid] = useState<null | boolean>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);

  // ---------- hydrate from server first, then draft ----------
  useEffect(() => {
    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id || null;
        const email = userData?.user?.email || null;
        if (uid && email) setMe({ id: uid, email });

        if (uid) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('first_name, screenname')
            .eq('id', uid)
            .maybeSingle();

          if (prof) {
            if (prof.first_name) setFirstName(prof.first_name);
            if (prof.screenname) {
              setScreenname(prof.screenname);
              setScreennameValid(true);
            }
          }
        }

        // merge in local draft (only fill if fields not already present)
        const draft = await loadDraft();
        if (!firstName && draft?.first_name) setFirstName(draft.first_name);
        if (!screenname && draft?.screenname) {
          setScreenname(draft.screenname);
          setScreennameValid(null); // revalidate on mount
        }
      } catch {
        // ignore
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- persist draft on changes ----------
  useEffect(() => {
    if (!hydrated) return;
    saveDraft({
      first_name: firstName || undefined,
      screenname: screenname || undefined,
      step: 'ProfileSetupStepThree',
    }).catch(() => {});
  }, [firstName, screenname, hydrated]);

  const generateSuggestions = useCallback((base: string) => {
    const clean = base.replace(/\s+/g, '');
    const n = Math.floor(Math.random() * 900) + 100;
    return [`${clean}${n}`, `${clean}_${n + 1}`, `${clean}${n + 2}`];
  }, []);

  // ---------- availability check (debounced) ----------
  const checkScreennameAvailability = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        setScreennameValid(null);
        setSuggestions([]);
        return;
      }

      try {
        setChecking(true);

        // case-insensitive equality via ilike, exclude my own id if I already have a screenname
        const query = supabase
          .from('profiles')
          .select('id', { count: 'exact' })
          .ilike('screenname', trimmed);

        const { data, count, error } = await query;

        if (error) {
          console.warn('[Screenname check error]', error.message);
          setScreennameValid(null);
          setSuggestions([]);
          return;
        }

        // if someone else uses it (or I haven't set mine yet), count > 0 means taken
        const takenByOther =
          (count ?? 0) > 0 &&
          (data ?? []).some((row) => row.id !== me?.id);

        if (takenByOther) {
          setScreennameValid(false);
          setSuggestions(generateSuggestions(trimmed));
        } else {
          setScreennameValid(true);
          setSuggestions([]);
        }
      } finally {
        setChecking(false);
      }
    },
    [me?.id, generateSuggestions]
  );

  const debouncedCheck = useDebouncedCallback((v: string) => {
    setScreennameValid(null);
    checkScreennameAvailability(v);
  }, 350);

  // ---------- handlers ----------
  const handleBack = async () => {
    try {
      await saveDraft({
        first_name: firstName || undefined,
        screenname: screenname || undefined,
        step: 'ProfileSetupStepTwo',
      });

      if (me?.id) {
        await supabase
          .from('profiles')
          .update({
            first_name: firstName || null,
            screenname: screenname || null,
            current_step: 'ProfileSetupStepTwo',
          })
          .eq('id', me.id);
      }
    } catch {}
    navigation.goBack();
  };

  const handlePickSuggestion = (s: string) => {
    setScreenname(s);
    setScreennameValid(null);
    debouncedCheck(s);
  };

  const handleNext = async () => {
    const trimmedFirstName = firstName.trim();
    const trimmedScreenname = screenname.trim();

    if (!trimmedFirstName || !trimmedScreenname) {
      Alert.alert('Missing Info', 'Both your first name and screenname are required.');
      return;
    }

    if (screennameValid !== true) {
      Alert.alert('Screenname', 'Please choose an available screenname.');
      return;
    }

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.id || !userData.user.email) {
        Alert.alert('Error', 'Unable to retrieve user information.');
        return;
      }
      const uid = userData.user.id;
      const email = userData.user.email;

      // Final server-side guard (in case someone grabbed it between checks):
      const { data: clash, error: clashErr } = await supabase
        .from('profiles')
        .select('id')
        .ilike('screenname', trimmedScreenname);

      if (clashErr) {
        console.error('[Screenname verify error]', clashErr);
        Alert.alert('Error', 'Error verifying screenname uniqueness.');
        return;
      }
      const takenByOther =
        (clash ?? []).some((row) => row.id !== uid);
      if (takenByOther) {
        setScreennameValid(false);
        setSuggestions(generateSuggestions(trimmedScreenname));
        Alert.alert('Screenname Taken', 'Please choose a different screenname.');
        return;
      }

      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: uid,
        email,
        screenname: trimmedScreenname,
        first_name: trimmedFirstName,
        current_step: 'ProfileSetupStepFour', // advance to Step 4
      });

      if (upsertError) {
        Alert.alert('Signup Error', upsertError.message);
        return;
      }

      await saveDraft({
        first_name: trimmedFirstName,
        screenname: trimmedScreenname,
        step: 'ProfileSetupStepFour',
      });

      navigation.navigate('ProfileSetupStepFour' as never, {
        screenname: trimmedScreenname,
        first_name: trimmedFirstName,
      } as never);
    } catch (err) {
      console.error('[SignupStepThree Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  // ---------- UI ----------
  const isNextDisabled =
    !firstName.trim() || !screenname.trim() || screennameValid !== true;

  const statusIcon = useMemo(() => {
    if (checking) return <ActivityIndicator size="small" color={DRYNKS_BLUE} />;
    if (screenname.length > 0 && screennameValid !== null) {
      return <Text style={styles.statusIconText}>{screennameValid ? '✅' : '❌'}</Text>;
    }
    return null;
  }, [checking, screenname.length, screennameValid]);

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // nudge content above keyboard; safe for most headers
        keyboardVerticalOffset={Math.max(0, insets.top + 64)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="always"
          >
            <Text style={styles.header}>Let’s Put a Name to That Smile 😄</Text>

            <TextInput
              style={styles.input}
              placeholder="First Name"
              value={firstName}
              onChangeText={(t) => setFirstName(t)}
              placeholderTextColor="#8A94A6"
              returnKeyType="next"
            />

            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.inputWithIcon}
                placeholder="Screenname (must be unique)"
                value={screenname}
                onChangeText={(val) => {
                  setScreenname(val);
                  setScreennameValid(null);
                  debouncedCheck(val);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor="#8A94A6"
                returnKeyType="done"
              />
              <View style={styles.statusIcon}>{statusIcon}</View>
            </View>

            {/* Suggestions if taken */}
            {screennameValid === false && suggestions.length > 0 && (
              <View style={styles.suggestionsWrap}>
                <Text style={styles.suggestionsLabel}>Suggestions:</Text>
                <View style={styles.suggestionsRow}>
                  {suggestions.map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => handlePickSuggestion(s)}
                      style={styles.suggestionPill}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.suggestionText}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <OnboardingNavButtons
              onNext={handleNext}
              onBack={handleBack}
              {...({ disabled: isNextDisabled } as any)}
            />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: DRYNKS_WHITE,
    paddingBottom: 24,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 20,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  input: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 15,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
  inputWrapper: {
    position: 'relative',
    marginBottom: 8,
  },
  inputWithIcon: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingRight: 44,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
  statusIcon: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    width: 28,
    alignItems: 'center',
  },
  statusIconText: {
    fontSize: 18,
  },
  suggestionsWrap: {
    marginBottom: 12,
  },
  suggestionsLabel: {
    color: '#6B7280',
    marginBottom: 6,
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionPill: {
    borderWidth: 1,
    borderColor: '#DADFE6',
    backgroundColor: '#EEF2F6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  suggestionText: {
    color: '#23303A',
    fontWeight: '600',
  },
});

export default SignupStepThree;
