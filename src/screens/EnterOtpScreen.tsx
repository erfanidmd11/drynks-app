// src/screens/EnterOtpScreen.tsx
// OTP verification with hardened session handling and safe profile initialization.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Text,
  TouchableWithoutFeedback,
  Keyboard,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@config/supabase';
import {
  clearCredentials,
  getCredentials,
  saveRefreshToken,
  clearRefreshToken,
} from '@utils/credentials';
import { loadDraft, saveDraft } from '@utils/onboardingDraft';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

type RouteParams = { email?: string; password?: string };

// ---------- helpers ----------
const MAX_HANDLE_ATTEMPTS = 3;

function genScreenname(email?: string | null, uid?: string) {
  const base = (email?.split('@')[0] || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  const suffix = (uid || Math.random().toString(36)).replace(/-/g, '').slice(0, 6);
  return `${base}_${suffix}`;
}

/**
 * Ensure a minimal row in public.profiles exists for the authenticated user.
 * Satisfies NOT NULL (screenname) and is idempotent.
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
    console.log('[EnterOtp] ensureProfileRow select error:', selErr);
    return;
  }
  if (existing) return;

  // Try a few times in case screenname collides with a unique constraint
  for (let i = 0; i < MAX_HANDLE_ATTEMPTS; i++) {
    const fallback = genScreenname(user.email, user.id + String(i));
    const { error: insErr } = await supabase.from('profiles').insert({
      id: user.id,
      screenname: fallback,
      first_name: fallback,
      email: user.email,
      agreed_to_terms: false,
      has_completed_profile: false,
      onboarding_complete: false,
    });
    if (!insErr) return;
    // 23505 = unique_violation (e.g., screenname unique); try again with a different suffix
    if ((insErr as any).code === '23505') continue;
    console.log('[EnterOtp] ensureProfileRow insert error:', insErr);
    return;
  }
}

export default function EnterOtpScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { email: emailParam, password: pwParam } = (route.params ?? {}) as RouteParams;

  const [email, setEmail] = useState<string>(emailParam || '');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(45);
  const tRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate email from saved creds/draft if not provided via route
  useEffect(() => {
    (async () => {
      if (!emailParam) {
        const creds = await getCredentials();
        if (creds.email) setEmail(creds.email);
        else {
          const draft = await loadDraft();
          if (draft?.email) setEmail(draft.email);
        }
      }
    })();
  }, [emailParam]);

  // Resend cooldown ticker
  useEffect(() => {
    if (tRef.current) clearInterval(tRef.current);
    tRef.current = setInterval(() => {
      setResendCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (tRef.current) clearInterval(tRef.current);
    };
  }, []);

  const handleVerify = async () => {
    if (!email) {
      Alert.alert('Missing email', 'Please go back and enter your email.');
      return;
    }
    if (!otp || otp.trim().length < 6) {
      Alert.alert('OTP Required', 'Please enter the 6-digit code.');
      return;
    }

    try {
      setLoading(true);

      // 1) Verify OTP for sign-up flow
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp.trim(),
        type: 'signup',
      });
      if (verifyError) {
        Alert.alert('OTP Error', verifyError.message);
        return;
      }

      // 2) Ensure we have a session; if not, attempt password sign-in as a fallback
      let { data: sessData } = await supabase.auth.getSession();
      let session = sessData?.session;
      if (!session) {
        const pw = pwParam || (await getCredentials()).password || '';
        if (pw) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password: pw,
          });
          if (signInError) {
            Alert.alert('Login Error', signInError.message);
            return;
          }
          const { data: refreshed } = await supabase.auth.getSession();
          session = refreshed?.session ?? null;
        }
      }

      // 3) Persist (or clear) refresh token for future boot
      const refreshToken = session?.refresh_token || null;
      if (refreshToken) await saveRefreshToken(refreshToken);
      else await clearRefreshToken();

      // 4) Ensure a minimal profiles row exists, then update with any local draft and advance step
      await ensureProfileRow();

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        Alert.alert('Session Issue', 'Please try logging in again.');
        return;
      }

      const draft = await loadDraft();

      // Build updates only with defined values to avoid overwriting with nulls
      const updates: Record<string, any> = { current_step: 'ProfileSetupStepTwo' };

      if (draft?.first_name) updates.first_name = draft.first_name;
      if (draft?.screenname) updates.screenname = draft.screenname; // optional; skip if you prefer to set later
      if (draft?.phone) updates.phone = draft.phone;
      if (draft?.birthdate) updates.birthdate = draft.birthdate;
      if (draft?.gender) updates.gender = draft.gender;
      if (Array.isArray(draft?.preferences) && draft.preferences.length)
        updates.preferences = draft.preferences;
      if (draft?.orientation) updates.orientation = draft.orientation;
      if (draft?.location) updates.location = draft.location;
      if (typeof draft?.latitude === 'number') updates.latitude = draft.latitude;
      if (typeof draft?.longitude === 'number') updates.longitude = draft.longitude;
      if (draft?.instagram) updates.instagram_handle = draft.instagram;
      if (draft?.tiktok) updates.tiktok_handle = draft.tiktok;
      if (draft?.facebook) updates.facebook_handle = draft.facebook;
      if (draft?.profile_photo) updates.profile_photo = draft.profile_photo;
      if (Array.isArray(draft?.gallery_photos) && draft.gallery_photos.length)
        updates.gallery_photos = draft.gallery_photos;

      // Safe UPDATE (no UPSERT) now that we know the row exists
      const { error: updateErr } = await supabase.from('profiles').update(updates).eq('id', uid);
      if (updateErr) {
        console.error('[EnterOtp] profile update error:', updateErr);
        Alert.alert('Database Error', 'Could not update your profile after verification.');
        return;
      }

      // Keep local step in sync; clear legacy password creds
      await saveDraft({ step: 'ProfileSetupStepTwo' });
      await clearCredentials();

      // Go to Step 2
      navigation.reset({ index: 0, routes: [{ name: 'ProfileSetupStepTwo' }] });
    } catch (error) {
      console.error('[OTP ERROR]', error);
      Alert.alert('Unexpected Error', 'Something went wrong during verification.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });
      if (error) {
        Alert.alert('Resend Error', error.message);
        return;
      }
      setResendCooldown(45);
      Alert.alert('OTP Sent', 'We emailed you a new code.');
    } catch (error) {
      console.error('[Resend OTP ERROR]', error);
      Alert.alert('Error', 'Could not resend OTP.');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: DRYNKS_WHITE }}
      keyboardVerticalOffset={Math.max(0, insets.top + 64)}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Image
            source={require('@assets/images/DrYnks_Y_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text style={styles.label}>Enter the 6‑digit OTP sent to your email</Text>
          <Text style={styles.emailHint}>{email || 'your@email.com'}</Text>

          <TextInput
            placeholder="123456"
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            style={styles.input}
            maxLength={6}
            autoFocus
            returnKeyType="done"
            blurOnSubmit
            placeholderTextColor="#98A4AE"
          />

          <TouchableOpacity
            style={[styles.button, loading && { opacity: 0.7 }]}
            onPress={handleVerify}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify Code</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.resendButton, resendCooldown > 0 && styles.resendDisabled]}
            onPress={handleResend}
            disabled={resendCooldown > 0}
          >
            <Text style={styles.resendText}>
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: DRYNKS_WHITE,
  },
  logo: {
    width: 84,
    height: 84,
    alignSelf: 'center',
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  emailHint: {
    fontSize: 14,
    textAlign: 'center',
    color: '#6B7280',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DADFE6',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    fontSize: 20,
    textAlign: 'center',
    letterSpacing: 6,
    color: '#111827',
  },
  button: {
    backgroundColor: DRYNKS_RED,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  resendButton: { marginTop: 16, alignItems: 'center', paddingVertical: 8 },
  resendDisabled: { opacity: 0.5 },
  resendText: { color: DRYNKS_RED, fontWeight: '700' },
  backButton: { marginTop: 10, alignItems: 'center' },
  backText: { color: '#007AFF', fontSize: 16, fontWeight: '500' },
});
