// src/utils/biometrics.ts
// Crash-safe facade for biometrics with NO runtime import of expo-local-authentication.
// Works even if the native module isn't in the binary (always returns safe fallbacks).

import { AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';
import Constants from 'expo-constants';

export type AuthResult = { success: boolean; error?: string };

// --- Kill switch (default DISABLED = '1') ---
function readBioFlag(): string {
  // Avoid TS/node type noise by accessing process via any
  const envFromProcess = ((process as any)?.env?.EXPO_PUBLIC_DISABLE_BIOMETRICS ?? '') as string;
  const envFromConfig = (((Constants as any)?.expoConfig?.extra?.EXPO_PUBLIC_DISABLE_BIOMETRICS) ??
    '') as string;
  return String(envFromProcess || envFromConfig || '1');
}
const RAW = readBioFlag();
export const BIO_DISABLED: boolean =
  RAW === '1' || (typeof RAW === 'string' && RAW.toLowerCase() === 'true');

// Minimal shape of the native module (not actually imported here)
type LA = {
  hasHardwareAsync(): Promise<boolean>;
  supportedAuthenticationTypesAsync(): Promise<number[]>;
  isEnrolledAsync(): Promise<boolean>;
  getEnrolledLevelAsync?(): Promise<number>;
  authenticateAsync(options?: unknown): Promise<{ success: boolean; error?: string }>;
};

// While the native module is removed, always return null.
export async function getLA(): Promise<LA | null> {
  return null;
}

// --- Helpers ---
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitActiveAndFirstFrame(): Promise<void> {
  if (Platform.OS === 'ios' && AppState.currentState !== 'active') {
    await new Promise<void>((resolve) => {
      const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
        if (s === 'active') {
          try {
            // RN 0.73+: remove via subscription.remove()
            (sub as unknown as { remove: () => void })?.remove?.();
          } catch {
            /* ignore */
          }
          resolve();
        }
      });
    });
  }
  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
  if (Platform.OS === 'ios') await sleep(600);
}

// --- API-compatible helpers (all safe fallbacks) ---
export async function hasHardwareAsync(): Promise<boolean> {
  const m = await getLA();
  if (!m) return false;
  try {
    return await m.hasHardwareAsync();
  } catch {
    return false;
  }
}

export async function supportedAuthenticationTypesAsync(): Promise<number[]> {
  const m = await getLA();
  if (!m) return [];
  try {
    return await m.supportedAuthenticationTypesAsync();
  } catch {
    return [];
  }
}

export async function isEnrolledAsync(): Promise<boolean> {
  const m = await getLA();
  if (!m) return false;
  try {
    const fn = (m as { isEnrolledAsync?: () => Promise<boolean> }).isEnrolledAsync;
    return typeof fn === 'function' ? !!(await fn()) : true;
  } catch {
    return false;
  }
}

export async function getEnrolledLevelAsync(): Promise<number> {
  const m = await getLA();
  if (!m || typeof (m as { getEnrolledLevelAsync?: () => Promise<number> }).getEnrolledLevelAsync !== 'function') {
    return 0;
  }
  try {
    return await (m as { getEnrolledLevelAsync: () => Promise<number> }).getEnrolledLevelAsync();
  } catch {
    return 0;
  }
}

export async function authenticateAsync(
  opts?: {
    promptMessage?: string;
    cancelLabel?: string;
    requireConfirmation?: boolean;
    disableDeviceFallback?: boolean;
  }
): Promise<AuthResult> {
  if (BIO_DISABLED) return { success: false };
  await waitActiveAndFirstFrame();

  const m = await getLA();
  if (!m) return { success: false };

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

// Default namespace export for callers that do:
//   import * as LocalAuthentication from '@utils/biometrics';
const LocalAuthentication = {
  hasHardwareAsync,
  supportedAuthenticationTypesAsync,
  isEnrolledAsync,
  getEnrolledLevelAsync,
  authenticateAsync,
};
export default LocalAuthentication;
