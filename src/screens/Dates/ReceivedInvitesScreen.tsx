// Received Invites — production-ready, RPC + DR authoritative + swipe only
// - Authoritative: public.date_requests (recipient_id=me, status='pending')
// - Accept/Decline via invites_decide(req_id,'accepted'|'declined')
// - Host rescind auto-removes via realtime on date_requests
// - Hydration parity with Feed (vw_feed_dates_v2 → vw_feed_dates → dates)
// - Accepted attendees from date_requests.status='accepted' (fallback: invites.accepted)
// - Swipe-only via DateCard: context="RECEIVED_INVITES" + hideReceivedButtons
// - Invite Friends parity: default DateCard behavior
// - Swipe affordance: arrows + grip; dismissed after first successful swipe

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';

type UUID = string;

const DRYNKS_RED = '#E34E5C';
const DRYNKS_GREEN = '#2ecc71';
const DRYNKS_TEXT = '#2B2B2B';
const SWIPE_HINT_KEY = 'received_invites_swipe_hint_dismissed';

/* ------------------------------ util helpers ------------------------------ */

const sumRemaining = (rgc?: Record<string, number> | null) =>
  Object.values(rgc ?? {}).reduce(
    (a, b) => a + (typeof b === 'number' ? b : 0),
    0
  );

function parseRemainingCounts(v: unknown): Record<string, number> | null {
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v))
    return v as Record<string, number>;
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' && !Array.isArray(o)
        ? (o as Record<string, number>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function getYMDInTZ(
  date: Date,
  timeZone: string
): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  let y = 0,
    m = 0,
    d = 0;
  for (const p of parts) {
    if (p.type === 'year') y = parseInt(p.value, 10);
    if (p.type === 'month') m = parseInt(p.value, 10);
    if (p.type === 'day') d = parseInt(p.value, 10);
  }
  return { y, m, d };
}
function isPastLocalEndOfDay(
  eventISO?: string | null,
  timeZone?: string | null
): boolean {
  if (!eventISO) return false;
  try {
    if (!timeZone) {
      const d = new Date(eventISO);
      return Number.isFinite(d.valueOf()) && d.getTime() < Date.now();
    }
    const event = new Date(eventISO);
    if (!Number.isFinite(event.valueOf())) return false;
    const e = getYMDInTZ(event, timeZone);
    const n = getYMDInTZ(new Date(), timeZone);
    return n.y * 10000 + n.m * 100 + n.d > e.y * 10000 + e.m * 100 + e.d;
  } catch {
    const d = new Date(eventISO);
    return Number.isFinite(d.valueOf()) && d.getTime() < Date.now();
  }
}
function formatEventDay(
  eventISO?: string | null,
  timeZone?: string | null
): string | null {
  if (!eventISO) return null;
  try {
    const d = new Date(eventISO);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    return null;
  }
}
const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));
const s1 = (...vals: Array<string | null | undefined>): string | null => {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
};
const a1 = <T,>(...vals: Array<T[] | null | undefined>): T[] | null => {
  for (const v of vals) if (Array.isArray(v) && v.length > 0) return v;
  for (const v of vals) if (Array.isArray(v)) return v;
  return null;
};
const toStrArray = (v: unknown): string[] | null => {
  if (!v && v !== '') return null;
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p.map((x) => String(x)).filter(Boolean);
    } catch {}
    return v.trim().length ? [v.trim()] : [];
  }
  return null;
};

/* ---------------------------- DB shapes ----------------------------- */

type DRRow = {
  id: UUID;
  date_id: UUID;
  requester_id: UUID;
  recipient_id: UUID;
  status: 'pending' | 'accepted' | 'rejected' | 'rescinded' | 'cancelled';
  created_at: string;
};

type ProfileHydrated = {
  id: UUID;
  screenname?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  orientation?: string | null;
  profile_photo?: string | null;
  location?: string | null;
  preferences?: string[] | null;
};

type HydratedBase = {
  id: UUID;
  title?: string | null;
  creator?: UUID | null;
  event_type?: string | null;
  event_date?: string | null;
  event_timezone?: string | null;
  location?: string | null;
  created_at?: string | null;
  profile_photo?: string | null;
  creator_photo?: string | null;
  date_cover?: string | null;
  photo_urls?: string[] | null;
  spots?: number | null;
  remaining_gender_counts?: Record<string, number> | null;
  orientation_preference?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  who_pays?: string | null;
};

/* ------------------------------ UI row ------------------------------ */

type ReceivedItem = {
  req_id: UUID;
  date_id: UUID;
  host_id: UUID;
  created_at: string;

  title: string | null;
  event_date: string | null;
  event_timezone: string | null;
  location: string | null;

  photo_urls: string[];
  profile_photo: string | null;
  cover_url: string | null;

  creator_id: UUID | null;
  creator_profile: ProfileHydrated | null;
  accepted_profiles: ProfileHydrated[];

  date_raw: HydratedBase;

  full: boolean;
  expired: boolean;
};

/* --------------------------- fetch helpers --------------------------- */

async function fetchProfilesMap(ids: UUID[]) {
  const map = new Map<UUID, ProfileHydrated>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return map;
  const { data } = await supabase
    .from('profiles')
    .select(
      'id, screenname, birthdate, gender, orientation, profile_photo, location, preferences'
    )
    .in('id', uniq);
  (data || []).forEach((p: any) => map.set(p.id, p));
  return map;
}

async function fetchAcceptedProfilesByDate(dateIds: UUID[]) {
  const res = new Map<UUID, ProfileHydrated[]>();
  if (!dateIds.length) return res;

  const { data: dr } = await supabase
    .from('date_requests')
    .select('date_id, recipient_id')
    .eq('status', 'accepted')
    .in('date_id', dateIds);

  const byDate = new Map<UUID, UUID[]>();
  const allUserIds: UUID[] = [];
  (dr || []).forEach((r: any) => {
    if (r.recipient_id) {
      byDate.set(r.date_id, [...(byDate.get(r.date_id) || []), r.recipient_id]);
      allUserIds.push(r.recipient_id);
    }
  });

  const needFallback = dateIds.filter((id) => !byDate.has(id));
  if (needFallback.length) {
    try {
      const { data: inv } = await supabase
        .from('invites')
        .select('date_id, invitee_id')
        .eq('status', 'accepted')
        .in('date_id', needFallback);
      (inv || []).forEach((r: any) => {
        byDate.set(r.date_id, [...(byDate.get(r.date_id) || []), r.invitee_id]);
        allUserIds.push(r.invitee_id);
      });
    } catch {}
  }

  const profileMap = await fetchProfilesMap(allUserIds);
  byDate.forEach((ids, dateId) => {
    res.set(
      dateId,
      ids
        .map((id) => profileMap.get(id))
        .filter(Boolean) as ProfileHydrated[]
    );
  });

  return res;
}

async function fetchHydratedDates(dateIds: UUID[]) {
  const map = new Map<UUID, HydratedBase>();
  if (!dateIds.length) return map;

  // Prefer the feed view (v2), then fallback to the previous view, then base dates
  try {
    const { data } = await supabase
      .from('vw_feed_dates_v2')
      .select(
        `
        id, title, creator, event_type, event_date, event_timezone, location, created_at,
        orientation_preference, spots, remaining_gender_counts,
        photo_urls, profile_photo, date_cover, creator_photo, latitude, longitude, who_pays
      `
      )
      .in('id', dateIds);
    (data || []).forEach((r: any) => map.set(r.id, r));
  } catch {}

  const missingFromV2 = dateIds.filter((id) => !map.has(id));
  if (missingFromV2.length) {
    try {
      const { data } = await supabase
        .from('vw_feed_dates')
        .select(
          `
          id, title, creator, event_type, event_date, event_timezone, location, created_at,
          orientation_preference, spots, remaining_gender_counts,
          photo_urls, profile_photo, latitude, longitude
        `
        )
        .in('id', missingFromV2);
      (data || []).forEach((r: any) => map.set(r.id, r));
    } catch {}
  }

  const missingFromViews = dateIds.filter((id) => !map.has(id));
  if (missingFromViews.length) {
    try {
      const { data } = await supabase
        .from('dates')
        .select(
          'id, title, event_date, event_timezone, location, created_at, profile_photo, photo_urls, spots, remaining_gender_counts, who_pays'
        )
        .in('id', missingFromViews);
      (data || []).forEach((r: any) => map.set(r.id, r));
    } catch {}
  }

  return map;
}

/* ------------------------------ UI: Swipe Hint ------------------------------ */

function SwipeHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <>
      <View pointerEvents="none" style={[styles.hint, { left: 8 }]}>
        <Text style={[styles.hintArrow, { color: DRYNKS_RED }]}>←</Text>
        <Text style={[styles.hintText, { color: DRYNKS_RED }]}>
          Swipe left to decline
        </Text>
      </View>
      <View
        pointerEvents="none"
        style={[styles.hint, { right: 8, flexDirection: 'row-reverse' }]}
      >
        <Text style={[styles.hintArrow, { color: DRYNKS_GREEN }]}>→</Text>
        <Text style={[styles.hintText, { color: DRYNKS_GREEN }]}>
          Swipe right to accept
        </Text>
      </View>
      <View pointerEvents="none" style={styles.grip} />
    </>
  );
}

/* ------------------------------- Screen ------------------------------- */

const ReceivedInvitesScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  useLayoutEffect(() => {
    navigation.setOptions?.({ headerShown: false });
  }, [navigation]);

  const [me, setMe] = useState<UUID | null>(null);
  const [rows, setRows] = useState<ReceivedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showHint, setShowHint] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const v = await AsyncStorage.getItem(SWIPE_HINT_KEY);
      if (v === '1') setShowHint(false);
    })();
  }, []);

  const markHintDismissed = useCallback(async () => {
    if (!showHint) return;
    setShowHint(false);
    try {
      await AsyncStorage.setItem(SWIPE_HINT_KEY, '1');
    } catch {}
  }, [showHint]);

  // realtime channels
  const chSelfRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDatesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDrByDateRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  );

  const detachRealtime = useCallback(() => {
    try {
      chSelfRef.current?.unsubscribe();
    } catch {}
    try {
      chDatesRef.current?.unsubscribe();
    } catch {}
    try {
      chDrByDateRef.current?.unsubscribe();
    } catch {}
    chSelfRef.current = null;
    chDatesRef.current = null;
    chDrByDateRef.current = null;
  }, []);

  const attachRealtime = useCallback(
    (dateIds: UUID[], viewer: UUID) => {
      detachRealtime();

      // Self DR changes (recipient = me): remove when status moves away from pending / or row deleted
      chSelfRef.current = supabase
        .channel(`rx_received_invites_self:${viewer}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'date_requests',
            filter: `recipient_id=eq.${viewer}`,
          },
          (payload) => {
            const s = String(payload?.new?.status || '').toLowerCase();
            if (s && s !== 'pending') {
              setRows((prev) => prev.filter((x) => x.req_id !== payload.new.id));
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'date_requests',
            filter: `recipient_id=eq.${viewer}`,
          },
          (payload) => {
            setRows((prev) => prev.filter((x) => x.req_id !== payload?.old?.id));
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'date_requests',
            filter: `recipient_id=eq.${viewer}`,
          },
          () => {
            fetchInvites(viewer);
          }
        )
        .subscribe(() => {});

      if (!dateIds.length) return;

      const idList = dateIds.map((id) => `"${id}"`).join(',');

      // Changes to source dates should refresh the row
      chDatesRef.current = supabase
        .channel(`rx_received_invites_dates:${viewer}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'dates', filter: `id=in.(${idList})` },
          () => {
            fetchInvites(viewer);
          }
        )
        .subscribe(() => {});

      // Any DR activity on these dates can affect accepted strip / capacity
      chDrByDateRef.current = supabase
        .channel(`rx_received_invites_dr_by_date:${viewer}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'date_requests',
            filter: `date_id=in.(${idList})`,
          },
          () => {
            fetchInvites(viewer);
          }
        )
        .subscribe(() => {});
    },
    [detachRealtime]
  );

  const fetchInvites = useCallback(
    async (uid?: UUID | null) => {
      const viewer = (uid ?? me) as UUID | null;
      if (!viewer) {
        setRows([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!refreshing) setLoading(true);

      const { data, error } = await supabase
        .from('date_requests')
        .select('id, date_id, requester_id, recipient_id, status, created_at')
        .eq('recipient_id', viewer)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[ReceivedInvites] load error', error);
        setRows([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const drs = (data || []) as DRRow[];
      if (!drs.length) {
        setRows([]);
        setLoading(false);
        setRefreshing(false);
        detachRealtime();
        return;
      }

      const dateIds = Array.from(new Set(drs.map((r) => r.date_id)));
      const hostIds = Array.from(new Set(drs.map((r) => r.requester_id)));

      const [baseMap, acceptedByDate, hosts] = await Promise.all([
        fetchHydratedDates(dateIds),
        fetchAcceptedProfilesByDate(dateIds),
        fetchProfilesMap(hostIds),
      ]);

      const built: ReceivedItem[] = drs
        .map((r) => {
          const d = baseMap.get(r.date_id) as HydratedBase | undefined;
          if (!d) return null as any;

          const tz = d?.event_timezone ?? null;
          const expired = d?.event_date
            ? isPastLocalEndOfDay(d.event_date, tz)
            : false;

          let full = false;
          const rgc = parseRemainingCounts(d?.remaining_gender_counts);
          if (rgc && Object.keys(rgc).length) {
            const total = sumRemaining(rgc);
            if (Number.isFinite(total)) full = (total as number) <= 0;
          } else if (typeof d?.spots === 'number') {
            const acceptedCount = (acceptedByDate.get(r.date_id) || []).length;
            full = acceptedCount >= (d?.spots ?? 0);
          }

          const rawPhotos: string[] = Array.isArray(d?.photo_urls)
            ? d.photo_urls!.filter(Boolean)
            : [];
          const creator_id =
            ((d?.creator as UUID | null) ?? (r.requester_id as UUID | null)) ||
            null;
          const creator_profile = creator_id
            ? hosts.get(creator_id) ?? null
            : null;

          const cover =
            d?.date_cover ||
            (rawPhotos.length ? rawPhotos[0] : null) ||
            d?.profile_photo ||
            creator_profile?.profile_photo ||
            null;

          const photo_urls = rawPhotos.length ? rawPhotos : cover ? [cover] : [];

          const location =
            d?.location && !looksLikeWKTOrHex(d.location)
              ? d.location
              : creator_profile?.location ?? null;

          return {
            req_id: r.id,
            date_id: r.date_id,
            host_id: r.requester_id,
            created_at: r.created_at,

            title: (d?.title ?? d?.event_type ?? null) as string | null,
            event_date: (d?.event_date ?? null) as string | null,
            event_timezone: tz,
            location: (location ?? null) as string | null,

            photo_urls,
            profile_photo: (d?.profile_photo ??
              creator_profile?.profile_photo ??
              null) as string | null,
            cover_url: (cover ?? null) as string | null,

            creator_id,
            creator_profile,
            accepted_profiles: acceptedByDate.get(r.date_id) || [],

            date_raw: d,

            full,
            expired,
          } as ReceivedItem;
        })
        .filter(Boolean) as ReceivedItem[];

      setRows(built);
      setLoading(false);
      setRefreshing(false);
      attachRealtime(dateIds, viewer as UUID);
    },
    [me, refreshing, attachRealtime, detachRealtime]
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchInvites();
  }, [fetchInvites]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id ?? null;
      setMe(uid);
      await fetchInvites(uid as UUID | null);
    })();
    return () => detachRealtime();
  }, [fetchInvites, detachRealtime]);

  useFocusEffect(
    React.useCallback(() => {
      fetchInvites();
      return () => {};
    }, [fetchInvites])
  );

  /* ------------------------- Accept / Decline via RPC ------------------------- */

  const accept = useCallback(
    async (row: ReceivedItem) => {
      try {
        const { error } = await supabase.rpc('invites_decide', {
          p_req_id: row.req_id,
          p_decision: 'accepted',
        });
        if (error) throw error;
        setRows((prev) => prev.filter((r) => r.req_id !== row.req_id));
        markHintDismissed();
      } catch (e: any) {
        const code = e?.code || e?.error?.code;
        const msg = String(e?.message || '');
        // If it's not pending anymore, just remove locally
        if (code === 'P0002' || msg.toLowerCase().includes('not-pending')) {
          setRows((prev) => prev.filter((r) => r.req_id !== row.req_id));
          markHintDismissed();
          return;
        }
        if (code === 'P0003') {
          Alert.alert('Action not allowed', 'You don’t have permission to accept this invite.');
          return;
        }
        console.error('[ReceivedInvites] accept error', e);
        Alert.alert('Could not accept invite', e?.message || 'Try again later.');
      }
    },
    [markHintDismissed]
  );

  const decline = useCallback(
    async (row: ReceivedItem) => {
      try {
        // IMPORTANT: use 'declined' for legacy invites mirror
        const { error } = await supabase.rpc('invites_decide', {
          p_req_id: row.req_id,
          p_decision: 'declined',
        });
        if (error) throw error;
        setRows((prev) => prev.filter((r) => r.req_id !== row.req_id));
        markHintDismissed();
      } catch (e: any) {
        const code = e?.code || e?.error?.code;
        const msg = String(e?.message || '');
        if (code === 'P0002' || msg.toLowerCase().includes('not-pending')) {
          setRows((prev) => prev.filter((r) => r.req_id !== row.req_id));
          markHintDismissed();
          return;
        }
        if (code === '23514') {
          // Check constraint on legacy invites (should not happen with mapping, but guard anyway)
          Alert.alert(
            'Could not decline invite',
            'Internal status mismatch. Please update and try again.'
          );
          return;
        }
        if (code === 'P0003') {
          Alert.alert('Action not allowed', 'You don’t have permission to decline this invite.');
          return;
        }
        console.error('[ReceivedInvites] decline error', e);
        Alert.alert(
          'Could not decline invite',
          e?.message || 'Try again later.'
        );
      }
    },
    [markHintDismissed]
  );

  /* ------------------------------- UI states ------------------------------- */

  if (loading) {
    return (
      <AppShell
        headerTitle="Received Invites"
        showBack
        backTint="#000"
        currentTab="My DrYnks"
      >
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8, color: '#666' }}>Loading…</Text>
        </View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell
        headerTitle="Received Invites"
        showBack
        backTint="#000"
        currentTab="My DrYnks"
      >
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Sign in to see your invites.</Text>
        </View>
      </AppShell>
    );
  }

  if (!rows.length) {
    return (
      <AppShell
        headerTitle="Received Invites"
        showBack
        backTint="#000"
        currentTab="My DrYnks"
      >
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No pending invites… yet. Your inbox is thirstier than a dry martini.
            🍸
          </Text>
        </View>
      </AppShell>
    );
  }

  // Stable key extractor
  const uniqueKey = (it: ReceivedItem) => `${it.req_id}:ri`;

  return (
    <AppShell
      headerTitle="Received Invites"
      showBack
      backTint="#000"
      currentTab="My DrYnks"
    >
      <FlatList
        data={rows}
        keyExtractor={uniqueKey}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 24,
          paddingTop: 8,
        }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 4, paddingBottom: 12 }}>
            <Text style={{ textAlign: 'center', color: '#444' }}>
              Swipe{' '}
              <Text style={{ fontWeight: '800', color: DRYNKS_RED }}>
                ← Left
              </Text>{' '}
              to decline ·{' '}
              <Text style={{ fontWeight: '800', color: DRYNKS_GREEN }}>
                Right →
              </Text>{' '}
              to accept
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        initialNumToRender={6}
        windowSize={10}
        removeClippedSubviews={false}
        renderItem={({ item }) => {
          const day = formatEventDay(item.event_date, item.event_timezone);
          const disabled = item.full || item.expired;

          return (
            <View style={styles.rowWrap}>
              <View style={styles.card}>
                {/* Tag above the card */}
                <View style={styles.tag}>
                  {item.cover_url ? (
                    <Image source={{ uri: item.cover_url }} style={styles.tagAvatar} />
                  ) : (
                    <View style={[styles.tagAvatar, styles.tagPlaceholder]}>
                      <Text style={styles.tagEmoji}>🍸</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tagTitle} numberOfLines={1}>
                      {item.title || 'Untitled date'}
                    </Text>
                    <Text style={styles.tagSub} numberOfLines={1}>
                      {day ? `${day}` : 'Upcoming'}
                      {item.location ? ` · ${item.location}` : ''}
                    </Text>
                  </View>
                </View>

                {/* DateCard — swipe-only; Invite Friends parity via default in-card handler */}
                <View style={{ position: 'relative' }}>
                  <DateCard
                    context="RECEIVED_INVITES"
                    hideReceivedButtons
                    date={{
                      ...(item.date_raw || {}),
                      id: item.date_id,
                      title: item.title ?? undefined,
                      event_date: item.event_date ?? undefined,
                      event_timezone: item.event_timezone ?? undefined,
                      location: item.location ?? undefined,
                      creator_id:
                        item.creator_id ?? item.date_raw?.creator ?? undefined,
                      creator_profile: item.creator_profile ?? undefined,
                      accepted_profiles: item.accepted_profiles ?? [],
                      photo_urls: item.photo_urls,
                      profile_photo: item.profile_photo ?? undefined,
                      who_pays: item.date_raw?.who_pays ?? undefined,
                    }}
                    userId={me!}
                    isCreator={false}
                    isAccepted={false}
                    disabled={disabled}
                    onPressProfile={(pid: string) => {
                      try {
                        navigation.navigate(
                          'PublicProfile' as never,
                          { userId: pid, origin: 'ReceivedInvites' } as never
                        );
                      } catch {}
                    }}
                    onAccept={() => accept(item)}
                    onDecline={() => decline(item)}
                    onChanged={(ev) => {
                      if (ev === 'removed') {
                        setRows((prev) =>
                          prev.filter((r) => r.req_id !== item.req_id)
                        );
                      }
                    }}
                  />
                  {/* Subtle swipe hint overlay (hidden forever after first successful swipe) */}
                  <SwipeHint visible={showHint} />
                </View>
              </View>
            </View>
          );
        }}
      />
    </AppShell>
  );
};

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: { fontSize: 16, color: '#666', textAlign: 'center' },

  rowWrap: { marginTop: 4, marginBottom: 16, borderRadius: 20 },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 3 },
    }),
  },

  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6E8EA',
    backgroundColor: '#FAFBFC',
  },
  tagAvatar: {
    width: 28,
    height: 28,
    borderRadius: 6,
    marginRight: 8,
    backgroundColor: '#EEE',
  },
  tagPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  tagEmoji: { fontSize: 16 },
  tagTitle: { color: DRYNKS_TEXT, fontWeight: '700' },
  tagSub: { color: '#6B7280', fontSize: 12, marginTop: 1 },

  // Swipe hint overlay
  hint: {
    position: 'absolute',
    top: 10,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  hintText: { fontSize: 12, fontWeight: '600' },
  hintArrow: { fontSize: 16, fontWeight: '800' },
  grip: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    marginLeft: -18,
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
});

export default ReceivedInvitesScreen;
