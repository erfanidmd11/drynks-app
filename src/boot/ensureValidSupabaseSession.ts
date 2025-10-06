import { supabase } from '@config/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Clears any stale Supabase auth tokens from AsyncStorage.
 * Safe to run even if the user is already signed out.
 */
export async function purgeSupabaseTokens(): Promise<void> {
  try {
    await supabase.auth.signOut().catch(() => {});
    const keys = await AsyncStorage.getAllKeys();
    // Supabase stores keys like: sb-<project-ref>-auth-token
    const sbKeys = keys.filter((k) => k.includes('-auth-token') || k.startsWith('sb-'));
    if (sbKeys.length) {
      await AsyncStorage.multiRemove(sbKeys).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

let ran = false;
/**
 * Run once on boot. If session is missing/invalid, purge tokens so we
 * don’t loop on "Invalid Refresh Token".
 */
export async function ensureValidSupabaseSessionOnce(): Promise<void> {
  if (ran) return;
  ran = true;
  try {
    const { data, error } = await supabase.auth.getSession();

    // If Supabase reports an error or there is no session, clean up.
    if (error || !data?.session) {
      await purgeSupabaseTokens();
      return;
    }

    // Optional extra safety: if refresh_token is somehow absent, purge.
    if (!data.session.refresh_token) {
      await purgeSupabaseTokens();
    }
  } catch {
    /* ignore; nothing fatal here */
  }
}
