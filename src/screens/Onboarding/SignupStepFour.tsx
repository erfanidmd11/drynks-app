// src/screens/Onboarding/SignupStepFour.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  SafeAreaView,
  Modal,
  FlatList,
  Pressable,
  ActivityIndicator,
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

const countryCodes = [
  { label: '+1 (US)', value: '+1' },
  { label: '+44 (UK)', value: '+44' },
  { label: '+61 (Australia)', value: '+61' },
  { label: '+91 (India)', value: '+91' },
  { label: '+33 (France)', value: '+33' },
  { label: '+49 (Germany)', value: '+49' },
  { label: '+81 (Japan)', value: '+81' },
  { label: '+86 (China)', value: '+86' },
  { label: '+34 (Spain)', value: '+34' },
];

// E.164: + and 7..15 digits total
const isE164 = (s: string) => /^\+[0-9]{7,15}$/.test(s);

function useDebounced<T extends any[]>(fn: (...args: T) => void, delay = 350) {
  const t = useRef<NodeJS.Timeout | null>(null);
  return useCallback((...args: T) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

const SignupStepFour = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { screenname, first_name } = route.params ?? {};

  const [countryCode, setCountryCode] = useState('+1');
  const [phone, setPhone] = useState('');
  const [phoneAvailable, setPhoneAvailable] = useState<boolean | null>(null);
  const [formatValid, setFormatValid] = useState<boolean | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);

  // Full E.164 candidate
  const fullPhone = useMemo(() => {
    const digits = phone.replace(/[^0-9]/g, '');
    // Remove '+' from countryCode if any (it already includes '+'), then concat and ensure one '+'
    const cc = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
    return `${cc}${digits}`;
  }, [countryCode, phone]);

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
            .select('phone')
            .eq('id', uid)
            .maybeSingle();
          if (prof?.phone) {
            // Try to split into code + local digits; if impossible, drop into E.164 baseline
            const match = String(prof.phone).match(/^\+([0-9]{1,3})([0-9]{6,})$/);
            if (match) {
              setCountryCode(`+${match[1]}`);
              setPhone(match[2]);
            } else {
              // default to +1 and keep digits if any
              setCountryCode('+1');
              setPhone(String(prof.phone).replace(/[^0-9]/g, ''));
            }
          }
        }

        // Merge local draft if present (doesn't override server if server had data)
        const draft = await loadDraft();
        if (draft?.phone && !phone) {
          // draft.phone expected E.164; attempt split
          const m = String(draft.phone).match(/^\+([0-9]{1,3})([0-9]{6,})$/);
          if (m) {
            setCountryCode(`+${m[1]}`);
            setPhone(m[2]);
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

  // ---------- Persist draft on change ----------
  useEffect(() => {
    if (!hydrated) return;
    // Save E.164 only if format is valid; otherwise save partial for resume
    const toSave = isE164(fullPhone) ? fullPhone : undefined;
    saveDraft({ phone: toSave, step: 'ProfileSetupStepFour' }).catch(() => {});
  }, [fullPhone, hydrated]);

  // ---------- Availability + format check (debounced) ----------
  const checkPhoneAvailability = useCallback(
    async (candidate: string) => {
      // Format check first
      const valid = isE164(candidate);
      setFormatValid(valid);

      if (!valid) {
        setPhoneAvailable(null);
        return;
      }

      try {
        setChecking(true);
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id || null;
        if (!uid) {
          setPhoneAvailable(null);
          return;
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('id')
          .eq('phone', candidate);

        if (error) {
          console.warn('[Phone Check Error]', error.message);
          setPhoneAvailable(null);
          return;
        }

        const takenByOther = (data?.length ?? 0) > 0 && (data ?? [])[0].id !== uid;
        setPhoneAvailable(!takenByOther);
      } catch (e) {
        console.warn('[Phone Check Error]', e);
        setPhoneAvailable(null);
      } finally {
        setChecking(false);
      }
    },
    []
  );

  const debouncedCheck = useDebounced((candidate: string) => {
    checkPhoneAvailability(candidate);
  }, 350);

  useEffect(() => {
    // Only kick off checks when there are at least ~7 local digits to avoid noise
    if (phone.replace(/[^0-9]/g, '').length >= 7) {
      debouncedCheck(fullPhone);
    } else {
      setFormatValid(null);
      setPhoneAvailable(null);
    }
  }, [phone, countryCode, fullPhone, debouncedCheck]);

  // ---------- Handlers ----------
  const handleBack = async () => {
    try {
      const draftPhone = isE164(fullPhone) ? fullPhone : undefined;
      await saveDraft({ phone: draftPhone, step: 'ProfileSetupStepThree' });

      if (me?.id) {
        await supabase
          .from('profiles')
          .update({
            phone: draftPhone ?? null,
            current_step: 'ProfileSetupStepThree',
          })
          .eq('id', me.id);
      }
    } catch {}
    navigation.goBack();
  };

  const handleNext = async () => {
    const valid = isE164(fullPhone);
    if (!valid) {
      Alert.alert(
        'Check your number',
        'Please enter a valid phone number (digits only) with the correct country code.'
      );
      return;
    }
    if (phoneAvailable === false) {
      Alert.alert(
        'Phone number already in use',
        'That phone number is already linked to another account.',
        [
          { text: 'Change number', style: 'cancel' },
          { text: 'Go to Login', onPress: () => navigation.navigate('Login' as never) },
        ]
      );
      return;
    }

    try {
      setLoadingNext(true);

      const { data: u, error: ue } = await supabase.auth.getUser();
      if (ue || !u?.user?.id || !u.user.email) {
        Alert.alert('Error', 'User authentication failed.');
        return;
      }
      const uid = u.user.id;
      const email = u.user.email;

      // Final server-side guard against race (unique index will also protect)
      const { data: existing, error: checkErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('phone', fullPhone);

      if (checkErr) {
        Alert.alert('Error', 'Could not validate phone number.');
        return;
      }

      const takenByOther = (existing?.length ?? 0) > 0 && (existing ?? [])[0].id !== uid;
      if (takenByOther) {
        Alert.alert(
          'Phone number already in use',
          'That phone number is already linked to another account.',
          [
            { text: 'Change number', style: 'cancel' },
            { text: 'Go to Login', onPress: () => navigation.navigate('Login' as never) },
          ]
        );
        return;
      }

      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: uid,
        email,
        screenname: screenname ?? null,
        first_name: first_name ?? null,
        phone: fullPhone,
        current_step: 'ProfileSetupStepFive',
      });

      if (upsertError) {
        const msg = upsertError.message?.toLowerCase() || '';
        if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('phone')) {
          Alert.alert(
            'Phone number already in use',
            'That phone number is already linked to another account.',
            [
              { text: 'Change number', style: 'cancel' },
              { text: 'Go to Login', onPress: () => navigation.navigate('Login' as never) },
            ]
          );
        } else {
          Alert.alert('Database Error', 'Could not save your phone number.');
        }
        return;
      }

      // Keep draft aligned (optional cache)
      await saveDraft({ phone: fullPhone, step: 'ProfileSetupStepFive' });

      navigation.navigate('ProfileSetupStepFive' as never, {
        screenname,
        first_name,
        phone: fullPhone,
      } as never);
    } catch (err) {
      console.error('[SignupStepFour Next Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong.');
    } finally {
      setLoadingNext(false);
    }
  };

  // ---------- UI ----------
  const status = useMemo(() => {
    if (checking) return '⏳';
    if (formatValid === null) return '';
    if (formatValid === false) return '❌';
    if (phoneAvailable === false) return '❌';
    if (formatValid && phoneAvailable) return '✅';
    return '';
  }, [checking, formatValid, phoneAvailable]);

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Math.max(0, insets.top + 64)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <ScrollView
              contentContainerStyle={styles.container}
              keyboardShouldPersistTaps="handled"
              contentInsetAdjustmentBehavior="always"
            >
              <Text style={styles.header}>
                {first_name ? `Hey ${first_name}, what's your number? 📱` : 'How Can We Reach You? 📱'}
              </Text>
              <Text style={styles.subtext}>
                Enter a phone number you can verify. This helps keep DrYnks safe.
              </Text>

              <View style={styles.phoneRow}>
                <Pressable style={styles.codeSelector} onPress={() => setModalVisible(true)}>
                  <Text style={styles.codeText}>{countryCode}</Text>
                </Pressable>
                <View style={{ flex: 1, position: 'relative' }}>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="Phone Number"
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={(text) => {
                      const digits = text.replace(/[^0-9]/g, '');
                      setPhone(digits);
                    }}
                    placeholderTextColor="#8A94A6"
                    returnKeyType="done"
                  />
                  {phone.length >= 7 && (
                    <Text style={styles.statusIcon}>{status}</Text>
                  )}
                </View>
              </View>

              <OnboardingNavButtons
                onBack={handleBack}
                onNext={handleNext}
                {...({ disabled: loadingNext || formatValid === false || phoneAvailable === false } as any)}
              />
              {loadingNext && <ActivityIndicator size="large" style={{ marginTop: 16 }} />}

              {/* Country picker modal */}
              <Modal
                visible={modalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setModalVisible(false)}
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <FlatList
                      data={countryCodes}
                      keyExtractor={(item) => item.value}
                      renderItem={({ item }) => (
                        <Pressable
                          onPress={() => {
                            setCountryCode(item.value);
                            setModalVisible(false);
                          }}
                          style={styles.countryItem}
                        >
                          <Text style={styles.countryText}>{item.label}</Text>
                        </Pressable>
                      )}
                    />
                  </View>
                </View>
              </Modal>
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    gap: 10,
  },
  codeSelector: {
    width: 110,
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: DRYNKS_GRAY,
  },
  codeText: {
    fontSize: 16,
    color: '#1F2A33',
  },
  phoneInput: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 16,
    paddingRight: 40,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
  statusIcon: {
    position: 'absolute',
    right: 10,
    top: 12,
    fontSize: 18,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: DRYNKS_WHITE,
    maxHeight: '40%',
    padding: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  countryItem: {
    paddingVertical: 15,
    paddingHorizontal: 10,
  },
  countryText: {
    fontSize: 18,
    color: '#1F2A33',
  },
});

export default SignupStepFour;
