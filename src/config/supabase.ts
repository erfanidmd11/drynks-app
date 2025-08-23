import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

const extra = (Constants?.expoConfig?.extra ?? {}) as any;
const supabaseUrl = (extra.SUPABASE_URL ?? process.env.SUPABASE_URL) as string;
const supabaseAnonKey = (extra.SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY) as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
