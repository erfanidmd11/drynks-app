// src/config/supabase.ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

// Work with both Expo Dev Client and EAS builds:
const extra =
  ((Constants?.expoConfig as any)?.extra ??
    (Constants as any)?.manifestExtra ??
    {}) as Record<string, any>;

// Prefer values embedded in app.config.ts -> extra
// Fall back to process.env (works in dev bundler)
const SUPABASE_URL =
  extra.SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  extra.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
}

// Helpful debug to catch ENV mismatches instantly (masked)
try {
  const maskedKey =
    typeof SUPABASE_ANON_KEY === 'string'
      ? SUPABASE_ANON_KEY.slice(0, 6) + '...' + SUPABASE_ANON_KEY.slice(-4)
      : '(undefined)';
  console.log('[Supabase] URL:', SUPABASE_URL || '(undefined)');
  console.log('[Supabase] ANON key (masked):', maskedKey);
} catch {}

export const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
  auth: {
    storage: AsyncStorage,         // ✅ persist session on device
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,     // ✅ RN apps don't read auth params from URL
  },
  global: { headers: { 'X-Client-Info': 'dr-ynks-app' } },
});
