// src/services/QuickUnlockService.ts
// Biometrics-free Quick Unlock service (no LocalAuthentication import anywhere)

import type * as SSType from 'expo-secure-store';
import { AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@config/supabase';

// ───────────────── Kill switch (kept for parity; we hard-disable below) ─────────────────
const RAW_BIO_FLAG = String(
  (process?.env?.EXPO_PUBLIC_DISABLE_BIOMETRICS ??
    (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_DISABLE_BIOMETRICS ??
    '1') as string // default OFF for safety
);

// Hard-disable biometrics at the service level while feature is removed
export const BIO_DISABLED = true;

// ───────────────── Lazy modules (safe even if native libs are absent) ─────────────────
let SS: typeof SSType | null = null;
async function getSS(): Promise<typeof SSType | null> {
  try {
    if (!SS) SS = (await import('expo-secure-store')) as unknown as typeof SSType;
    return SS!;
  } catch {
    return null;
  }
}

async function getAS() {
  try {
    return (await import('@react-native-async-storage/async-storage')).default;
  } catch {
    return null as any;
  }
}

const KEYCHAIN = 'dr-ynks.bio';
const K_ENABLED = 'bio_enabled';
const K_REFRESH = 'bio_refresh_token';
const K_ARMED = 'quick:armed';

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
async function waitActiveAndFirstFrame() {
  if (AppState.currentState !== 'active') {
    await new Promise<void>((resolve) => {
      const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
        if (s === 'active') {
          try { sub.remove(); } catch {}
          resolve();
        }
      });
    });
  }
  await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => resolve()));
  await sleep(Platform.OS === 'ios' ? 300 : 100);
}

// ───────────────── Public API (biometrics-free stubs) ─────────────────
export async function isBiometricAvailable(): Promise<boolean> {
  return false; // never claim availability without native module
}
export const deviceSupportsBiometrics = isBiometricAvailable;

export async function isQuickUnlockEnabled(): Promise<boolean> {
  return false; // feature off while biometrics are removed
}

// Overloads preserved for call sites
export async function enableQuickUnlock(_refreshToken: string): Promise<void>;
export async function enableQuickUnlock(_userId: string, _refreshToken: string): Promise<void>;
export async function enableQuickUnlock(): Promise<void> {
  // No-op while biometrics are removed
  throw new Error('disabled');
}

export async function disableQuickUnlock(): Promise<void> {
  try {
    const S = await getSS();
    if (S) {
      await S.deleteItemAsync(K_REFRESH, { keychainService: KEYCHAIN } as any);
      await S.deleteItemAsync(K_ENABLED, { keychainService: KEYCHAIN } as any);
    }
  } finally {
    const AS = await getAS();
    await AS?.removeItem(K_ARMED);
  }
}

export async function enableQuickUnlockFromCurrentSession(): Promise<void> {
  throw new Error('disabled');
}

export async function armForNextAppEntry() {
  // keep harmless for future re-enable paths
  const AS = await getAS();
  await AS?.setItem(K_ARMED, '0'); // mark as not armed while disabled
}
async function disarm() {
  const AS = await getAS();
  await AS?.removeItem(K_ARMED);
}

// Keep signature; do nothing but maintain listeners for future parity
export function attachQuickUnlockRotationListener(): () => void {
  const { data: sub } = supabase.auth.onAuthStateChange(async (event) => {
    try {
      if (event === 'SIGNED_OUT') await disableQuickUnlock();
    } catch {}
  });
  return () => sub.subscription?.unsubscribe?.();
}

// Session helper (retained for parity; unused while disabled)
async function setSessionFromRefreshToken(refresh_token: string) {
  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error) throw error;

  const newRt = data?.session?.refresh_token;
  if (newRt && newRt !== refresh_token) {
    try {
      const S = await getSS();
      if (S) await S.setItemAsync(K_REFRESH, String(newRt), { keychainService: KEYCHAIN } as any);
    } catch {}
  }
}

// Prompts/login flows return false so callers short-circuit gracefully
export async function tryPromptIfArmed(
  _onSuccessWithRefreshToken?: (rt: string) => Promise<void>
): Promise<boolean> {
  await waitActiveAndFirstFrame();
  await disarm();
  return false;
}

export async function promptQuickUnlock(): Promise<boolean> {
  return false;
}

export async function attemptBiometricLogin(): Promise<boolean> {
  return false;
}
