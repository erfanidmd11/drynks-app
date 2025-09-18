// src/utils/biometrics.ts
// Crash-safe facade for biometrics with dynamic import of expo-local-authentication.
// Works even if the native module isn't in the binary (returns safe fallbacks).
// Honors EXPO_PUBLIC_DISABLE_BIOMETRICS (1/true => disabled).

import { AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';
import Constants from 'expo-constants';

export type AuthResult = { success: boolean; error?: string };

type LA = {
  hasHardwareAsync(): Promise<boolean>;
  supportedAuthenticationTypesAsync(): Promise<number[]>;
  isEnrolledAsync(): Promise<boolean>;
  getEnrolledLevelAsync?(): Promise<number>;
  authenticateAsync(options?: {
    promptMessage?: string;
    cancelLabel?: string;
    requireConfirmation?: boolean;
    disableDeviceFallback?: boolean;
  }): Promise<{ success: boolean; error?: string }>;
};

let cachedModule: LA | null | undefined; // undefined = not attempted, null = attempted but missing

// --- Kill switch (default ENABLED) ---
function readBioFlag(): string {
  const fromProcess = ((process as any)?.env?.EXPO_PUBLIC_DISABLE_BIOMETRICS ?? '') as string;
  const fromConfig = (((Constants as any)?.expoConfig?.extra?.EXPO_PUBLIC_DISABLE_BIOMETRICS) ?? '') as string;
  return String(fromProcess || fromConfig || '');
}
const RAW = readBioFlag();
// Disabled if explicitly '1' or 'true' (case-insensitive)
export const BIO_DISABLED: boolean = RAW === '1' || RAW.toLowerCase?.() === 'true';

// --- Safe timing helpers ---
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitActiveAndFirstFrame(): Promise<void> {
  if (Platform.OS === 'ios' && AppState.currentState !== 'active') {
    await new Promise<void>((resolve) => {
      const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
        if (s === 'active') {
          try {
            (sub as unknown as { remove: () => void })?.remove?.();
          } catch {}
          resolve();
        }
      });
    });
  }
  await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => resolve()));
  if (Platform.OS === 'ios') await sleep(400);
}

// --- Dynamic import (only once) ---
export async function getLA(): Promise<LA | null> {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // Dynamically import only when needed; avoids crashes if the native module is not present.
    const mod = await import('expo-local-authentication');
    // Verify minimum shape
    if (mod && typeof mod.hasHardwareAsync === 'function' && typeof mod.authenticateAsync === 'function') {
      cachedModule = mod as unknown as LA;
    } else {
      cachedModule = null;
    }
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

// --- API-compatible helpers (all safe fallbacks) ---
export async function hasHardwareAsync(): Promise<boolean> {
  if (BIO_DISABLED) return false;
  const m = await getLA();
  if (!m) return false;
  try { return await m.hasHardwareAsync(); } catch { return false; }
}

export async function supportedAuthenticationTypesAsync(): Promise<number[]> {
  if (BIO_DISABLED) return [];
  const m = await getLA();
  if (!m) return [];
  try { return await m.supportedAuthenticationTypesAsync(); } catch { return []; }
}

export async function isEnrolledAsync(): Promise<boolean> {
  if (BIO_DISABLED) return false;
  const m = await getLA();
  if (!m) return false;
  try { return await m.isEnrolledAsync(); } catch { return false; }
}

export async function getEnrolledLevelAsync(): Promise<number> {
  if (BIO_DISABLED) return 0;
  const m = await getLA();
  if (!m || typeof m.getEnrolledLevelAsync !== 'function') return 0;
  try { return await m.getEnrolledLevelAsync!(); } catch { return 0; }
}

export async function authenticateAsync(opts?: {
  promptMessage?: string;
  cancelLabel?: string;
  requireConfirmation?: boolean;
  disableDeviceFallback?: boolean;
}): Promise<AuthResult> {
  if (BIO_DISABLED) return { success: false, error: 'disabled' };

  // Ensure app is active & UI is ready (prevents iOS prompt timing issues)
  await waitActiveAndFirstFrame();

  const m = await getLA();
  if (!m) return { success: false, error: 'module_missing' };

  const base =
    Platform.OS === 'ios'
      ? ({ promptMessage: 'Unlock', disableDeviceFallback: true } as const)
      : ({ promptMessage: 'Unlock', cancelLabel: 'Cancel', requireConfirmation: false } as const);

  try {
    const res = await m.authenticateAsync({ ...base, ...(opts ?? {}) });
    return { success: !!res?.success, error: res?.error };
  } catch (e: unknown) {
    return { success: false, error: (e as Error)?.message ?? 'auth_failed' };
  }
}

// Default namespace export: allows `import * as LocalAuthentication from '@utils/biometrics'`
const LocalAuthentication = {
  hasHardwareAsync,
  supportedAuthenticationTypesAsync,
  isEnrolledAsync,
  getEnrolledLevelAsync,
  authenticateAsync,
};
export default LocalAuthentication;
