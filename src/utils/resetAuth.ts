// src/utils/resetAuth.ts
// Clear any locally cached Supabase auth state (safe to call before/after sign-in).
// This avoids "Invalid Refresh Token" noise when dev accounts are deleted/reset.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@config/supabase';

const SB_PREFIX = 'sb-'; // supabase-js stores keys with this prefix in AsyncStorage

/**
 * Clears only the local device session + cached keys.
 * Does NOT revoke the server session (safer in dev/production).
 */
export async function resetAuthLocal() {
  try {
    // Clear the Supabase client’s local session
    await supabase.auth.signOut({ scope: 'local' });
  } catch (e) {
    // ignore
  }

  try {
    // Purge cached sb-* keys so the client starts clean next boot
    const keys = await AsyncStorage.getAllKeys();
    const sbKeys = keys.filter((k) => k.startsWith(SB_PREFIX));
    if (sbKeys.length) {
      await AsyncStorage.multiRemove(sbKeys);
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Optional debug helper: dump current sb-* auth keys (do not ship in logs).
 */
export async function dumpAuthKeys(): Promise<Record<string, string>> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const sbKeys = keys.filter((k) => k.startsWith(SB_PREFIX));
    const pairs = await AsyncStorage.multiGet(sbKeys);
    return Object.fromEntries(pairs.map(([k, v]) => [k, String(v)]));
  } catch {
    return {};
  }
}
