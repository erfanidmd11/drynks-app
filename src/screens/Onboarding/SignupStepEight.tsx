// src/screens/Onboarding/SignupStepEight.tsx
import React, { useEffect, useState } from 'react';
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

type RouteParams = {
  screenname?: string | null;
  first_name?: string | null;
  phone?: string | null;
};

const sanitize = (s: string) => s.replace(/^@+/, '').trim();

const SignupStepEight = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { screenname, first_name, phone } = (route.params || {}) as RouteParams;

  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [facebook, setFacebook] = useState('');
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
            .select('instagram_handle, tiktok_handle, facebook_handle')
            .eq('id', uid)
            .maybeSingle();

          if (prof) {
            if (prof.instagram_handle) setInstagram(String(prof.instagram_handle));
            if (prof.tiktok_handle) setTiktok(String(prof.tiktok_handle));
            if (prof.facebook_handle) setFacebook(String(prof.facebook_handle));
          }
        }

        if (!instagram && !tiktok && !facebook) {
          const draft = await loadDraft();
          if (draft?.instagram) setInstagram(String(draft.instagram));
          if (draft?.tiktok) setTiktok(String(draft.tiktok));
          if (draft?.facebook) setFacebook(String(draft.facebook));
        }
      } catch {
        // ignore
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Persist draft whenever any field changes ----------
  useEffect(() => {
    if (!hydrated) return;
    saveDraft({
      instagram: instagram || undefined,
      tiktok: tiktok || undefined,
      facebook: facebook || undefined,
      step: 'ProfileSetupStepEight',
    }).catch(() => {});
  }, [instagram, tiktok, facebook, hydrated]);

  // ---------- Handlers ----------
  const handleBack = async () => {
    try {
      await saveDraft({
        instagram: instagram || undefined,
        tiktok: tiktok || undefined,
        facebook: facebook || undefined,
        step: 'ProfileSetupStepSeven',
      });

      if (me?.id) {
        await supabase
          .from('profiles')
          .update({
            instagram_handle: instagram || null,
            tiktok_handle: tiktok || null,
            facebook_handle: facebook || null,
            current_step: 'ProfileSetupStepSeven',
          })
          .eq('id', me.id);
      }
    } catch {}
    navigation.goBack();
  };

  const handleNext = async () => {
    try {
      setSaving(true);

      const { data: u, error: ue } = await supabase.auth.getUser();
      if (ue || !u?.user?.id || !u.user.email) {
        Alert.alert('Session Error', 'Please log in again.');
        return;
      }
      const uid = u.user.id;
      const email = u.user.email;

      // Sanitize just in case user typed "@handle"
      const ig = sanitize(instagram);
      const tt = sanitize(tiktok);
      const fb = sanitize(facebook);

      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert({
          id: uid,
          email,
          screenname: screenname ?? null,
          first_name: first_name ?? null,
          phone: phone ?? null,
          instagram_handle: ig || null,
          tiktok_handle: tt || null,
          facebook_handle: fb || null,
          current_step: 'ProfileSetupStepNine', // advance to Step 9 (Location)
        });

      if (upsertError) {
        console.error('[Supabase Upsert Error]', upsertError);
        Alert.alert('Error', 'Could not save social handles.');
        return;
      }

      await saveDraft({
        instagram: ig || undefined,
        tiktok: tt || undefined,
        facebook: fb || undefined,
        step: 'ProfileSetupStepNine',
      });

      navigation.navigate('ProfileSetupStepNine' as never, {
        screenname,
        first_name,
        phone,
      } as never);
    } catch (err) {
      console.error('[SignupStepEight Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ---------- UI ----------
  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Math.max(0, insets.top + 64)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="always"
          >
            <View style={styles.inner}>
              <Text style={styles.header}>
                {screenname ? `Almost there, @${screenname}! 🔐` : 'Almost there! 🔐'}
              </Text>
              <Text style={styles.subtext}>
                Drop your Instagram, TikTok, or Facebook handle — any or none. This won’t be shared;
                it helps us keep DrYnks safe and spam-free. 🍸
              </Text>

              <TextInput
                style={styles.input}
                placeholder="@instagram"
                value={instagram}
                onChangeText={setInstagram}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor="#8A94A6"
                returnKeyType="next"
              />

              <TextInput
                style={styles.input}
                placeholder="@tiktok"
                value={tiktok}
                onChangeText={setTiktok}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor="#8A94A6"
                returnKeyType="next"
              />

              <TextInput
                style={styles.input}
                placeholder="@facebook"
                value={facebook}
                onChangeText={setFacebook}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor="#8A94A6"
                returnKeyType="done"
              />

              <View style={{ marginTop: 20 }}>
                <OnboardingNavButtons
                  onBack={handleBack}
                  onNext={handleNext}
                  {...({ nextLabel: saving ? 'Saving…' : 'Next', disabled: !!saving } as any)}
                />
              </View>
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
    backgroundColor: DRYNKS_WHITE,
  },
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
  input: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
});

export default SignupStepEight;
