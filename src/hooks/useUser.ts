// src/hooks/useUser.ts
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@config/supabase';

type UseUserResult = {
  user: User | null;
  loading: boolean;
};

export const useUser = (): UseUserResult => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      // Initialize from current session (v2 API)
      const { data: sessionRes } = await supabase.auth.getSession();
      if (isMounted) {
        setUser(sessionRes?.session?.user ?? null);
        setLoading(false);
      }
    };

    init();

    // Keep in sync with auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) setUser(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  return { user, loading };
};
