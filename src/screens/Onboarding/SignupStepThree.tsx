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

// ---- Brand colors ----
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

/** Build a set of common "auto" variants derived from the user's email local-part. */
function emailDerivedCandidates(email?: string | null) {
  const set = new Set<string>();
  if (!email) return { firstName: set, screen: set };

  const local = email.split('@')[0] || '';
  const lower = local.toLowerCase().trim();

  const tokens = lower.split(/[._-]+/).filter(Boolean); // john.smith-22 -> ['john','smith','22']
  const first = tokens[0] || lower;
  const noPunct = lower.replace(/[._-]+/g, '');
  const noDigits = lower.replace(/\d+/g, '');
  const noPunctNoDigits = noPunct.replace(/\d+/g, '');

  // What we commonly see auto-filled as first name:
  [first, noDigits, noPunctNoDigits].forEach(v => v && set.add(v));

  // Screenname-style variants:
  const screen = new Set<string>([
    lower,
    noPunct,
    noDigits,
    noPunctNoDigits,
    first,
    tokens.slice(0, 2).join(''),          // johnsmith
    tokens.slice(0, 2).join('_'),         // john_smith
    tokens.slice(0, 2).join('.'),         // john.smith
    tokens.slice(0, 2).join('-'),         // john-smith
  ].filter(Boolean) as string[]);

  return { firstName: set, screen };
}

function looksAutoFromEmail(value: string, email: string, which: 'first' | 'screen') {
  const norm = value?.toLowerCase().trim();
  if (!norm) return false;
  const c = emailDerivedCandidates(email);
  return which === 'first' ? c.firstName.has(norm) : c.screen.has(norm);
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

  // ---------------- hydrate (server first, then draft) ----------------
  useEffect(() => {
    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id || null;
        const email = userData?.user?.email || null;
        if (uid && email) setMe({ id: uid, email });

        // 1) Read server profile — BUT DO NOT PREFILL if the value looks auto-derived from email.
        if (uid) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('first_name, screenname, email')
            .eq('id', uid)
            .maybeSingle();

          const em = email || (prof as any)?.email || undefined;

          if (prof && em) {
            if (prof.first_name && !looksAutoFromEmail(String(prof.first_name), em, 'first')) {
              setFirstName(String(prof.first_name));
            }
            if (prof.screenname && !looksAutoFromEmail(String(prof.screenname), em, 'screen')) {
              setScreenname(String(prof.screenname));
              // still start unvalidated so we can re-check on change/submit
              setScreennameValid(null);
            }
          }
        }

        // 2) Merge local draft — also ignore email-derived junk
        const draft = await loadDraft();
        if (draft) {
          if (!firstName && draft.first_name && !(email && looksAutoFromEmail(draft.first_name, email, 'first'))) {
            setFirstName(draft.first_name);
          }
          if (!screenname && draft.screenname && !(email && looksAutoFromEmail(draft.screenname, email, 'screen'))) {
            setScreenname(draft.screenname);
            setScreennameValid(null);
          }
        }
      } catch {
        // ignore hydrate errors
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- persist draft on change ----------------
  useEffect(() => {
    if (!hydrated) return;
    // Save only what user has typed (can be blank)
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

  // ---------------- availability check (debounced) ----------------
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

        // case-insensitive equality via ILIKE without wildcards
        const { data, count, error } = await supabase
          .from('profiles')
          .select('id', { count: 'exact' })
          .ilike('screenname', trimmed);

        if (error) {
          if (__DEV__) console.warn('[Screenname check error]', error.message);
          setScreennameValid(null);
          setSuggestions([]);
          return;
        }

        const myId = me?.id;
        const takenByOther = (count ?? 0) > 0 && (data ?? []).some((row) => row.id !== myId);

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

  // ---------------- handlers ----------------
  const handleBack = async () => {
    try {
      await saveDraft({
        first_name: firstName || undefined,
        screenname: screenname || undefined,
        step: 'ProfileSetupStepTwo',
      });

      // Only touch server columns if the user has typed something
      if (me?.id) {
        const patch: any = { current_step: 'ProfileSetupStepTwo' };
        if (firstName.trim().length) patch.first_name = firstName.trim();
        if (screenname.trim().length) patch.screenname = screenname.trim();

        if (patch.first_name || patch.screenname) {
          await supabase.from('profiles').update(patch).eq('id', me.id);
        }
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
    const trimmedFirst = firstName.trim();
    const trimmedScreen = screenname.trim();

    if (!trimmedFirst || !trimmedScreen) {
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

      // Final guard: uniqueness
      const { data: clash, error: clashErr } = await supabase
        .from('profiles')
        .select('id')
        .ilike('screenname', trimmedScreen);

      if (clashErr) {
        if (__DEV__) console.error('[Screenname verify error]', clashErr);
        Alert.alert('Error', 'Error verifying screenname uniqueness.');
        return;
      }
      const takenByOther = (clash ?? []).some((row) => row.id !== uid);
      if (takenByOther) {
        setScreennameValid(false);
        setSuggestions(generateSuggestions(trimmedScreen));
        Alert.alert('Screenname Taken', 'Please choose a different screenname.');
        return;
      }

      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: uid,
        email,
        screenname: trimmedScreen,
        first_name: trimmedFirst,
        current_step: 'ProfileSetupStepFour',
      });

      if (upsertError) {
        Alert.alert('Signup Error', upsertError.message);
        return;
      }

      await saveDraft({
        first_name: trimmedFirst,
        screenname: trimmedScreen,
        step: 'ProfileSetupStepFour',
      });

      navigation.navigate('ProfileSetupStepFour' as never, {
        screenname: trimmedScreen,
        first_name: trimmedFirst,
      } as never);
    } catch (err) {
      if (__DEV__) console.error('[SignupStepThree Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  // ---------------- UI ----------------
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
              autoCapitalize="words"
              autoCorrect={false}
              // discourage platform autofill heuristics
              autoComplete="off"
              textContentType="givenName"
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
                autoComplete="off"
                textContentType="username"
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
  inputWrapper: { position: 'relative', marginBottom: 8 },
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
  statusIconText: { fontSize: 18 },
  suggestionsWrap: { marginBottom: 12 },
  suggestionsLabel: { color: '#6B7280', marginBottom: 6 },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestionPill: {
    borderWidth: 1,
    borderColor: '#DADFE6',
    backgroundColor: '#EEF2F6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  suggestionText: { color: '#23303A', fontWeight: '600' },
});

export default SignupStepThree;
