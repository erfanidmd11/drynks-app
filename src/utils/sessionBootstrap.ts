// src/utils/sessionBootstrap.ts
// Silently restore Supabase session from a stored refresh token on app start.
// Also exposes helpers to listen for auth changes and to perform a clean logout.

import { supabase } from '@config/supabase';
import {
  getRefreshToken,
  saveRefreshToken,
  clearRefreshToken,
  clearCredentials, // legacy email/password (safe to keep for migration)
} from '@utils/credentials';
import { clearDraft } from '@utils/onboardingDraft';

let hasBootstrapped = false;

/**
 * Attempt to restore a session using the saved refresh token.
 * If a valid session already exists, this is a no-op.
 * Returns `true` when a session is available afterwards.
 */
export async function bootstrapSession(): Promise<boolean> {
  // If we already have a session in memory, short-circuit.
  const { data: current } = await supabase.auth.getSession();
  if (current?.session?.access_token) return true;

  // Avoid double work if multiple callers race on app start.
  if (hasBootstrapped) {
    const { data: again } = await supabase.auth.getSession();
    return !!again?.session?.access_token;
  }
  hasBootstrapped = true;

  try {
    const token = await getRefreshToken();
    if (!token) return false;

    // setSession will exchange refresh_token -> new access token
    const { data, error } = await supabase.auth.setSession({
      refresh_token: token,
      access_token: '', // not needed; Supabase will fetch a new access token
    });

    if (error) {
      // Token invalid/expired → clear local copy
      await clearRefreshToken();
      return false;
    }

    // Persist the (possibly rotated) refresh token
    const newRefresh = data?.session?.refresh_token;
    if (newRefresh && newRefresh !== token) {
      await saveRefreshToken(newRefresh);
    }

    return !!data?.session?.access_token;
  } catch (e) {
    // Any unexpected failure → fail gracefully
    return false;
  }
}

/**
 * Listen for auth state changes and keep the stored refresh token in sync.
 * Returns an unsubscribe function.
 */
export function listenForAuthChanges(): () => void {
  const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
    // Keep refresh token synchronized when it rotates.
    const rt = session?.refresh_token || null;

    if (event === 'SIGNED_OUT') {
      await clearRefreshToken();
      await clearCredentials(); // legacy
      await clearDraft();
      return;
    }

    if (rt) {
      await saveRefreshToken(rt);
    }
  });

  return () => {
    try {
      sub.subscription?.unsubscribe();
    } catch {}
  };
}

/**
 * Perform a clean logout (server + local).
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } finally {
    await clearRefreshToken();
    await clearCredentials(); // legacy
    await clearDraft();
  }
}
