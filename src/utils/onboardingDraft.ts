// @utils/onboardingDraft.ts
// Local draft storage for onboarding (pre-OTP + cache post-OTP)
// Safe to extend with extra fields if you need.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'onboarding_draft_v1';

export type Draft = {
  step?: string;

  // Step 1
  email?: string;
  password?: string; // only if you need between Step 1 -> OTP

  // Step 2
  birthdate?: string; // YYYY-MM-DD

  // Step 3
  first_name?: string;
  screenname?: string;

  // Step 4
  phone?: string; // E.164

  // Step 5
  gender?: string | null;

  // Step 6
  preferences?: string[];

  // Step 7
  orientation?: string;

  // Step 8
  instagram?: string;
  tiktok?: string;
  facebook?: string;

  // Step 9
  location?: string;
  latitude?: number | null;
  longitude?: number | null;

  // Step 10
  profile_photo?: string | null;      // local URI or remote URL
  gallery_photos?: string[];          // local URIs or remote URLs

  // Step 11
  agreed_to_terms?: boolean;
};

export async function loadDraft(): Promise<Draft> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Draft) : {};
}

export async function saveDraft(patch: Partial<Draft>) {
  const current = await loadDraft();
  const next: Draft = { ...current, ...patch };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function clearDraft() {
  await AsyncStorage.removeItem(KEY);
}
