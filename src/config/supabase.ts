// src/config/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://amtvilzctpeapjqtwnlk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtdHZpbHpjdHBlYXBqcXR3bmxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk0NDY3NDQsImV4cCI6MjA2NTAyMjc0NH0.jH2R6IM-gBMTyhr-o-hdUjZgpUOfmzhrE2S5kX3VPnQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
