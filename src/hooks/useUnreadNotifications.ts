// src/hooks/useUnreadNotifications.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@config/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export function useUnreadNotifications() {
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const userIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const mountedRef = useRef(true);
  const reqSeq = useRef(0); // prevents stale setState
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchCount = useCallback(async () => {
    const mySeq = ++reqSeq.current;

    const { data: { session } = {} } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    userIdRef.current = uid;

    if (!uid) {
      if (mountedRef.current) {
        setCount(0);
        setLoading(false);
      }
      return;
    }

    const { count: exactCount, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('read', false);

    if (!mountedRef.current || mySeq !== reqSeq.current) return;
    if (!error && typeof exactCount === 'number') setCount(exactCount);
    setLoading(false);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { fetchCount(); }, 150);
  }, [fetchCount]);

  const subscribe = useCallback(async () => {
    // clean old channel first
    if (channelRef.current) {
      try { await channelRef.current.unsubscribe(); } catch {}
      try { supabase.removeChannel(channelRef.current); } catch {}
      channelRef.current = null;
    }

    const { data: { session } = {} } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    if (!uid) return;

    const ch = supabase
      .channel(`notifications_${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        () => scheduleRefresh()
      )
      .subscribe();

    channelRef.current = ch;
  }, [scheduleRefresh]);

  useEffect(() => {
    fetchCount();
    subscribe();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        userIdRef.current = null;
        setCount(0);
        setLoading(false);
      }
      fetchCount();
      subscribe();
    });

    return () => {
      try { subscription.unsubscribe(); } catch {}
      if (channelRef.current) {
        try { channelRef.current.unsubscribe(); } catch {}
        try { supabase.removeChannel(channelRef.current); } catch {}
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchCount, subscribe]);

  const markAllRead = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', uid)
      .eq('read', false);

    if (!error) {
      // optimistic, then confirm via debounced refetch
      setCount(0);
      scheduleRefresh();
    }
  }, [scheduleRefresh]);

  return { count, loading, markAllRead, refresh: fetchCount };
}
