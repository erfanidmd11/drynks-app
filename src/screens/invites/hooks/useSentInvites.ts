// src/screens/invites/hooks/useSentInvites.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@config/supabase';

type UUID = string;

export type SentInvite = {
  id: UUID;               // date_requests.id
  date_id: UUID;
  status: 'pending' | 'accepted' | 'rejected' | 'rescinded' | 'cancelled';
  created_at: string;
  recipient_id: UUID;
  date: {
    id: UUID;
    title: string | null;
    event_date: string | null;
    location: string | null;
    profile_photo: string | null;
  };
  recipient: {
    id: UUID;
    screenname: string | null;
    profile_photo: string | null;
    location: string | null;
  };
};

export function useSentInvites(userId: string | null) {
  const [rows, setRows] = useState<SentInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchRows = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      setErrorMsg(null);
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    // Only PENDING invites you (host) sent
    const { data, error } = await supabase
      .from('date_requests')
      .select(`
        id, date_id, status, created_at,
        recipient_id,
        date:dates!inner ( id, title, event_date, location, profile_photo ),
        recipient:profiles!recipient_id ( id, screenname, profile_photo, location )
      `)
      .eq('requester_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      setErrorMsg(error.message || 'Failed to load sent invites.');
      setRows([]);
    } else {
      // Strongly type cast so downstream is predictable
      const cleaned = (data || []).map((r: any) => ({
        id: r.id,
        date_id: r.date_id,
        status: r.status,
        created_at: r.created_at,
        recipient_id: r.recipient_id,
        date: {
          id: r.date?.id ?? r.date_id,
          title: r.date?.title ?? null,
          event_date: r.date?.event_date ?? null,
          location: r.date?.location ?? null,
          profile_photo: r.date?.profile_photo ?? null,
        },
        recipient: {
          id: r.recipient?.id ?? r.recipient_id,
          screenname: r.recipient?.screenname ?? null,
          profile_photo: r.recipient?.profile_photo ?? null,
          location: r.recipient?.location ?? null,
        },
      })) as SentInvite[];
      setRows(cleaned);
    }

    setLoading(false);
  }, [userId]);

  // Realtime: remove if any of my sent invites leave "pending"
  useEffect(() => {
    // tear down any previous
    try { chRef.current?.unsubscribe(); } catch {}
    chRef.current = null;

    if (!userId) return;

    const ch = supabase
      .channel(`sent-invites:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'date_requests', filter: `requester_id=eq.${userId}` },
        (payload) => {
          const newStatus = String(payload.new?.status || '').toLowerCase();
          if (newStatus !== 'pending') {
            const id = payload.new?.id as string;
            setRows((curr) => curr.filter((r) => r.id !== id));
          }
        }
      )
      // also re-add immediately if a new PENDING invite is inserted
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'date_requests', filter: `requester_id=eq.${userId}` },
        (payload) => {
          const s = String(payload.new?.status || '').toLowerCase();
          if (s === 'pending') {
            // fetch once to hydrate recipient/date joins for that one row
            fetchRows();
          }
        }
      )
      .subscribe();

    chRef.current = ch;

    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [userId, fetchRows]);

  // Initial + manual refresh
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const refresh = useCallback(() => fetchRows(), [fetchRows]);

  // Optional: grouping by date_id (UI convenience)
  const groupedByDate = useMemo(() => {
    const map = new Map<UUID, SentInvite[]>();
    for (const r of rows) map.set(r.date_id, [...(map.get(r.date_id) || []), r]);
    return map; // key: date_id → array of invites
  }, [rows]);

  return { rows, groupedByDate, loading, errorMsg, refresh, setRows };
}
