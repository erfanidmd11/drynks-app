// src/screens/Dates/MySentInvitesScreen.tsx
// My Sent Invites — production-ready (dual-backend support)
// - NEW flow: v_sent_invites + updates to public.date_requests (requester=host)
// - LEGACY flow: public.invites (pending) with revoke via status='revoked'
// - DateTag row (title + friendly date + location) above each ProfileCard
// - Swipe RIGHT to rescind (no inline buttons)
// - Source of truth for date info: date_requests (fallback: dates)
// - Realtime: self (date_requests + invites), affected dates, and invites-on-those-dates
// - Robust 'full' detection and end-of-day expiry in event timezone
// - Polished empty state

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
  Platform,
  Image,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInUp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import ProfileCard from '@components/cards/ProfileCard';
import { notifyInviteRevoked } from '@services/NotificationService';

type UUID = string;

const DRYNKS_RED   = '#E34E5C';
const DRYNKS_BLUE  = '#232F39';
const DRYNKS_TEXT  = '#2B2B2B';
const SCREEN_W = Dimensions.get('window').width;

/* ------------------------------ helpers ------------------------------ */

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const sumRemaining = (rgc?: Record<string, number> | null) =>
  Object.values(rgc ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

/** Safely parse remaining_gender_counts whether it's jsonb, text, or null */
function parseRemainingCounts(v: unknown): Record<string, number> | null {
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, number>;
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, number>) : null;
    } catch { return null; }
  }
  return null;
}

/** Get Y-M-D of a Date as it appears in an IANA time zone */
function getYMDInTZ(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  let y = 0, m = 0, d = 0;
  for (const p of parts) {
    if (p.type === 'year')  y = parseInt(p.value, 10);
    if (p.type === 'month') m = parseInt(p.value, 10);
    if (p.type === 'day')   d = parseInt(p.value, 10);
  }
  return { y, m, d };
}

/** True iff today (in event TZ) is after the event's calendar date */
function isPastLocalEndOfDay(eventISO?: string | null, timeZone?: string | null): boolean {
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
    const eNum = e.y * 10000 + e.m * 100 + e.d;
    const nNum = n.y * 10000 + n.m * 100 + n.d;
    return nNum > eNum;
  } catch {
    const d = new Date(eventISO);
    return Number.isFinite(d.valueOf()) && d.getTime() < Date.now();
  }
}

/** Friendly date like "Sat, Oct 25" in the event's timezone */
function formatEventDay(eventISO?: string | null, timeZone?: string | null): string | null {
  if (!eventISO) return null;
  try {
    const d = new Date(eventISO);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return fmt.format(d);
  } catch { return null; }
}

/* ---------------------------- DB shapes ----------------------------- */

// NEW view (host -> recipients)
type ViewSentRow = {
  req_id: UUID;
  date_id: UUID;
  recipient_id: UUID;
  created_at: string;
  status?: string | null;         // if present, we filter to 'pending'
  // Optional convenience columns (may or may not exist):
  title?: string | null;
  event_date?: string | null;
  event_timezone?: string | null;
};

// LEGACY invites table
type InviteRow = {
  id: UUID;
  date_id: UUID;
  inviter_id: UUID;
  invitee_id: UUID;
  status: 'pending' | 'accepted' | 'revoked' | 'dismissed';
  created_at: string;
};

// Date (from date_requests preferred; fallback dates)
type DateRow = {
  id: UUID;
  title?: string | null;
  event_date?: string | null;
  event_timezone?: string | null;
  who_pays?: string | null;
  event_type?: string | null;
  orientation_preference?: string[] | null;
  profile_photo?: string | null;
  photo_urls?: string[] | null;
  cover_image_url?: string | null;
  creator?: UUID | null;
  creator_id?: UUID | null;
  user_id?: UUID | null;
  uid?: UUID | null;
  spots?: number | null;
  remaining_gender_counts?: any;      // jsonb | text | null
  location?: string | null;
  location_str?: string | null;
};

// Recipient profile
type ProfileRow = {
  id: UUID;
  screenname: string | null;
  profile_photo?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gender?: string | null;
  orientation?: string | string[] | null;
  about?: string | null;
  gallery_photos?: any;
};

/* ------------------------------ UI row ------------------------------ */

type SentItem = {
  req_id: UUID;
  date_id: UUID;
  recipient_id: UUID;
  created_at: string;

  user: {
    id: UUID;
    screenname: string;
    profile_photo?: string | null;
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    gender?: string | null;
    orientation?: string | null;
    about?: string | null;
    gallery_photos?: string[];
  };

  date_title: string | null;
  event_date: string | null;
  event_timezone: string | null;
  date_location: string | null;
  date_photo_url: string | null;

  creator_id: UUID | null;
  who_pays?: string | null;
  event_type?: string | null;

  full: boolean;
  expired: boolean;
};

/* ---------------------------- Row component ---------------------------- */

type SentRowProps = {
  index: number;
  item: SentItem;
  onRescind: (row: SentItem) => void;
  onOpenProfile: (userId: string) => void;
};

const SentRow = React.memo<SentRowProps>(({ index, item, onRescind, onOpenProfile }) => {
  const tx = useSharedValue(0);
  const threshold = Math.min(140, SCREEN_W * 0.33);

  const pan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onStart(() => { tx.value = 0; })
    .onUpdate((e) => { tx.value = e.translationX; })
    .onEnd((e) => {
      if (e.translationX > threshold) {
        tx.value = withSpring(SCREEN_W, {}, () => runOnJS(onRescind)(item));
      } else {
        tx.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: tx.value > 0 ? 'rgba(46,204,113,0.12)' : 'transparent',
  }));

  const disabled = item.expired || item.full;
  const day = formatEventDay(item.event_date, item.event_timezone);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View entering={FadeInUp.delay(index * 50).duration(300)} style={[styles.rowWrap, bgStyle]}>
        <Animated.View style={cardStyle}>
          <View style={styles.cardWrap}>
            {/* --- DateTag row (association to the date) --- */}
            <View style={[styles.dateTag, disabled && { opacity: 0.55 }]}>
              {item.date_photo_url ? (
                <Image source={{ uri: item.date_photo_url }} style={styles.dateTagAvatar} />
              ) : (
                <View style={[styles.dateTagAvatar, styles.dateTagPlaceholder]}>
                  <Text style={styles.dateTagEmoji}>🍸</Text>
                </View>
              )}

              <View style={{ flex: 1 }}>
                <Text style={styles.dateTagTitle} numberOfLines={1}>
                  {item.date_title || 'Untitled date'}
                </Text>
                <Text style={styles.dateTagSub} numberOfLines={1}>
                  {day ? `${day}` : 'Upcoming'}
                  {item.date_location ? ` · ${item.date_location}` : ''}
                </Text>
              </View>
            </View>

            {/* --- Invitee Profile --- */}
            <ProfileCard
              user={item.user}
              compact
              origin="MySentInvites"
              invited
              onInvite={() => { /* swipe to rescind instead */ }}
              onPressProfile={() => onOpenProfile(item.user.id)}
              onNamePress={() => onOpenProfile(item.user.id)}
              onAvatarPress={() => onOpenProfile(item.user.id)}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

/* ------------------------------- Screen ------------------------------- */

const MySentInvitesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const headerTitle = 'My Sent Invites';

  useEffect(() => { navigation.setOptions?.({ headerShown: false }); }, [navigation]);

  const [me, setMe] = useState<UUID | null>(null);
  const [rows, setRows] = useState<SentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // realtime channels
  const chInvitesSelfRef   = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDrSelfRef        = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDateReqRef       = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chInvitesDatesRef  = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // session
  useEffect(() => {
    (async () => {
      const [{ data: sess }, { data: user }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ]);
      const uid = sess?.session?.user?.id ?? user?.user?.id ?? null;
      setMe(uid);
    })();
  }, []);

  // one-time hint (quiet)
  useEffect(() => {
    (async () => {
      try {
        const seen = await AsyncStorage.getItem('hint_my_sent_invites_v7');
        if (!seen) await AsyncStorage.setItem('hint_my_sent_invites_v7', 'true');
      } catch {}
    })();
  }, []);

  /* ------------------------- helpers: fetchers ------------------------- */

  const fetchDateRequestsMap = useCallback(async (ids: UUID[]) => {
    const map = new Map<UUID, DateRow>();
    if (!ids.length) return map;

    // 1) prefer date_requests
    let rows: any[] = [];
    try {
      const { data } = await supabase.from('date_requests').select('*').in('id', ids);
      rows = data || [];
    } catch {/* ignore */}

    // 2) fallback to dates for any missing ids
    const found = new Set(rows.map(r => r.id));
    const missing = ids.filter(id => !found.has(id));
    if (missing.length) {
      const { data: d2 } = await supabase.from('dates').select('*').in('id', missing);
      rows = rows.concat(d2 || []);
    }

    rows.forEach((row: any) => map.set(row.id, row as DateRow));
    return map;
  }, []);

  const fetchProfilesMap = useCallback(async (ids: UUID[]) => {
    const map = new Map<UUID, ProfileRow>();
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length) return map;
    const { data } = await supabase
      .from('profiles')
      .select(
        'id, screenname, profile_photo, location, latitude, longitude, gender, orientation, about, gallery_photos'
      )
      .in('id', uniq);
    (data || []).forEach((row: any) => map.set(row.id, row));
    return map;
  }, []);

  const fetchAcceptedCounts = useCallback(async (ids: UUID[]) => {
    // Prefer event_attendees; fallback to legacy accepted invites tally
    const counts = new Map<UUID, number>();
    if (!ids.length) return counts;

    try {
      const { data } = await supabase
        .from('event_attendees')
        .select('date_id')
        .in('date_id', ids);
      (data || []).forEach((r: any) => {
        counts.set(r.date_id, (counts.get(r.date_id) ?? 0) + 1);
      });
    } catch { /* ignore; we'll fallback */ }

    const missing = ids.filter(id => !counts.has(id));
    if (missing.length) {
      try {
        const { data } = await supabase
          .from('invites')
          .select('date_id')
          .eq('status', 'accepted')
          .in('date_id', missing);
        (data || []).forEach((r: any) => {
          counts.set(r.date_id, (counts.get(r.date_id) ?? 0) + 1);
        });
      } catch { /* ignore */ }
    }

    return counts;
  }, []);

  /* ------------------ detect + query (view or legacy) ------------------ */

  const fetchSentCore = useCallback(async (hostId: UUID) => {
    // Try new view first
    try {
      const { data, error } = await supabase
        .from('v_sent_invites')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        const rows = (data as ViewSentRow[])
          .filter(r => !r.status || r.status === 'pending'); // if status exists, keep only pending
        if (rows.length) {
          return {
            kind: 'view' as const,
            pending: rows.map(r => ({
              req_id: r.req_id,
              date_id: r.date_id,
              recipient_id: r.recipient_id,
              created_at: r.created_at,
              // pass-through optional fields if present (used later only as hints)
              _title: r.title ?? null,
              _event_date: r.event_date ?? null,
              _event_tz: r.event_timezone ?? null,
            })),
          };
        }
      }
    } catch { /* ignore and fall back */ }

    // Legacy: invites I sent and still pending
    const { data, error } = await supabase
      .from('invites')
      .select('id, date_id, inviter_id, invitee_id, status, created_at')
      .eq('inviter_id', hostId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    const rows = (data ?? []) as InviteRow[];
    return {
      kind: 'legacy' as const,
      pending: rows.map(r => ({
        req_id: r.id,
        date_id: r.date_id,
        recipient_id: r.invitee_id,
        created_at: r.created_at,
      })),
    };
  }, []);

  /* ----------------------------- main fetch ---------------------------- */

  const fetchRows = useCallback(async () => {
    if (!me) { setRows([]); setLoading(false); setRefreshing(false); return; }
    if (!refreshing) setLoading(true);

    let core: Awaited<ReturnType<typeof fetchSentCore>>;
    try { core = await fetchSentCore(me); } catch (e) {
      console.error('[MySentInvites] fetch core error', e);
      setRows([]); setLoading(false); setRefreshing(false);
      return;
    }

    const pending = core.pending;
    if (!pending.length) {
      setRows([]); setLoading(false); setRefreshing(false);
      detachRealtime();
      // still attach base watchers so new rows show up without manual refresh
      attachDrSelfRealtime(me);
      attachInvitesSelfRealtime(me);
      return;
    }

    const dateIds     = Array.from(new Set(pending.map((r) => r.date_id)));
    const recipientIds= Array.from(new Set(pending.map((r) => r.recipient_id)));

    const [eventMap, profileMap, acceptedCounts] = await Promise.all([
      fetchDateRequestsMap(dateIds),
      fetchProfilesMap(recipientIds),
      fetchAcceptedCounts(dateIds),
    ]);

    const cleaned: SentItem[] = pending.map((r) => {
      const d = eventMap.get(r.date_id) as DateRow | undefined;
      const p = profileMap.get(r.recipient_id) as ProfileRow | undefined;

      // Build recipient card user
      const collapsedOrientation = Array.isArray(p?.orientation)
        ? (p?.orientation[0] as string | undefined)
        : (p?.orientation as string | undefined);

      const user = {
        id: r.recipient_id,
        screenname: p?.screenname ?? 'Guest',
        profile_photo: p?.profile_photo ?? null,
        location: p?.location ?? undefined,
        latitude: p?.latitude ?? undefined,
        longitude: p?.longitude ?? undefined,
        gender: p?.gender ?? null,
        orientation: collapsedOrientation ?? null,
        about: p?.about ?? null,
        gallery_photos: Array.isArray(p?.gallery_photos) ? (p?.gallery_photos as string[]) : [],
      };

      // compute "full" safely
      let full = false;
      const rgc = parseRemainingCounts(d?.remaining_gender_counts);
      if (rgc && Object.keys(rgc).length > 0) {
        const total = sumRemaining(rgc);
        if (Number.isFinite(total)) full = (total as number) <= 0;
      } else if (typeof d?.spots === 'number') {
        const acceptedByDate = acceptedCounts.get(r.date_id) ?? 0;
        full = acceptedByDate >= (d?.spots ?? 0);
      }

      const expired = d?.event_date
        ? isPastLocalEndOfDay(d.event_date, (d as any)?.event_timezone ?? null)
        : false;

      // date tag photo
      let datePhoto: string | null = null;
      if ((d as any)?.cover_image_url) datePhoto = String((d as any).cover_image_url);
      else if (Array.isArray(d?.photo_urls) && d!.photo_urls!.length) datePhoto = String(d!.photo_urls![0]);
      else if (d?.profile_photo) datePhoto = String(d.profile_photo);

      // location (avoid rendering WKT blobs)
      const cleanLoc =
        (d?.location && !looksLikeWKTOrHex(d.location) ? d.location : null) ||
        (d as any)?.location_str ||
        null;

      return {
        req_id: r.req_id,
        date_id: r.date_id,
        recipient_id: r.recipient_id,
        created_at: r.created_at,

        user,

        // prefer DB title; if view hinted a title/date/tz, use those when missing
        date_title: (d?.title ?? (r as any)?._title ?? null) as string | null,
        event_date: (d?.event_date ?? (r as any)?._event_date ?? null) as string | null,
        event_timezone: ((d as any)?.event_timezone ?? (r as any)?._event_tz ?? null) as string | null,
        date_location: cleanLoc,
        date_photo_url: datePhoto,

        creator_id: ((d?.creator_id ?? d?.creator ?? d?.user_id ?? d?.uid) ?? null) as UUID | null,
        who_pays: (d?.who_pays ?? null) as string | null,
        event_type: (d?.event_type ?? null) as string | null,

        full,
        expired,
      } as SentItem;
    }).filter((it) => !it.full && !it.expired);

    // Sort newest first (created_at desc)
    cleaned.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    setRows(cleaned);
    setLoading(false);
    setRefreshing(false);

    // realtime watchers
    attachDrSelfRealtime(me);          // new flow: my date_requests rows (requester=me)
    attachInvitesSelfRealtime(me);     // legacy flow: my invites rows (inviter=me)
    attachDateRequestsRealtime(dateIds);
    attachInvitesForDatesRealtime(dateIds);
  }, [
    me,
    refreshing,
    fetchSentCore,
    fetchDateRequestsMap,
    fetchProfilesMap,
    fetchAcceptedCounts,
  ]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRows();
  }, [fetchRows]);

  /* ---------------------------- realtime bindings --------------------------- */

  const attachInvitesSelfRealtime = useCallback((viewer: string) => {
    try { chInvitesSelfRef.current?.unsubscribe(); } catch {}
    chInvitesSelfRef.current = supabase
      .channel('my_sent_invites_self_legacy_rx')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invites', filter: `inviter_id=eq.${viewer}` },
        () => { fetchRows(); }
      )
      .subscribe(() => {});
  }, [fetchRows]);

  const attachDrSelfRealtime = useCallback((viewer: string) => {
    try { chDrSelfRef.current?.unsubscribe(); } catch {}
    chDrSelfRef.current = supabase
      .channel('my_sent_invites_self_dr_rx')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'date_requests', filter: `requester_id=eq.${viewer}` },
        () => { fetchRows(); }
      )
      .subscribe(() => {});
  }, [fetchRows]);

  const attachDateRequestsRealtime = useCallback((ids: UUID[]) => {
    try { chDateReqRef.current?.unsubscribe(); } catch {}
    if (!ids.length) { chDateReqRef.current = null; return; }
    const idList = ids.join(',');
    chDateReqRef.current = supabase
      .channel('my_sent_invites_date_requests_rx')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'date_requests', filter: `id=in.(${idList})` },
        () => { fetchRows(); }
      )
      .subscribe(() => {});
  }, [fetchRows]);

  const attachInvitesForDatesRealtime = useCallback((ids: UUID[]) => {
    try { chInvitesDatesRef.current?.unsubscribe(); } catch {}
    if (!ids.length) { chInvitesDatesRef.current = null; return; }
    const idList = ids.join(',');
    chInvitesDatesRef.current = supabase
      .channel('my_sent_invites_dates_invites_rx')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'invites', filter: `date_id=in.(${idList})` },
        () => { fetchRows(); }
      )
      .subscribe(() => {});
  }, [fetchRows]);

  const detachRealtime = useCallback(() => {
    try { chInvitesSelfRef.current?.unsubscribe(); } catch {}
    try { chDrSelfRef.current?.unsubscribe(); } catch {}
    try { chDateReqRef.current?.unsubscribe(); } catch {}
    try { chInvitesDatesRef.current?.unsubscribe(); } catch {}
    chInvitesSelfRef.current = null;
    chDrSelfRef.current = null;
    chDateReqRef.current = null;
    chInvitesDatesRef.current = null;
  }, []);

  // first mount + focus refresh
  useEffect(() => {
    (async () => { await fetchRows(); })();
    return () => detachRealtime();
  }, [fetchRows, detachRealtime]);

  useFocusEffect(useCallback(() => { fetchRows(); return () => {}; }, [fetchRows]));

  // prune locally (handles crossing midnight in event TZ without server events)
  useEffect(() => {
    const t = setInterval(() => setRows((prev) =>
      prev.filter((r) => !r.full && !isPastLocalEndOfDay(r.event_date, r.event_timezone))
    ), 60_000);
    return () => clearInterval(t);
  }, []);

  /* --------------------------- navigation helpers --------------------------- */

  const openProfile = useCallback((userId: string) => {
    try {
      navigation.navigate('PublicProfile' as never, { userId, origin: 'MySentInvites' } as never);
    } catch {
      try { navigation.navigate('Profile' as never, { userId, origin: 'MySentInvites' } as never); } catch {}
    }
  }, [navigation]);

  const goToDateFeed = useCallback(() => {
    try { navigation.navigate('DateFeed' as never); } catch {}
  }, [navigation]);

  const goToMyDates = useCallback(() => {
    const candidates = ['MyDates', 'My DrYnks', 'MyDatesScreen', 'MyDatesTab'];
    for (const name of candidates) {
      try { navigation.navigate(name as never); return; } catch {}
    }
    goToDateFeed();
  }, [navigation, goToDateFeed]);

  /* -------------------------------- actions -------------------------------- */

  const rescindInvite = useCallback(async (row: SentItem) => {
    // Try NEW flow first: cancel the request in date_requests (requester = me/host)
    try {
      const { error, data } = await supabase
        .from('date_requests')
        .update({ status: 'cancelled' })
        .eq('id', row.req_id)
        .select('id')
        .single();
      if (!error && data) {
        setRows((prev) => prev.filter((r) => r.req_id !== row.req_id));
        try {
          await notifyInviteRevoked({
            recipientId: row.recipient_id,
            dateId: row.date_id,
            eventTitle: row.date_title || 'your date',
          });
        } catch {}
        return;
      }
    } catch { /* fall back to legacy */ }

    // Legacy revoke
    try {
      const { error } = await supabase.from('invites').update({ status: 'revoked' }).eq('id', row.req_id);
      if (error) throw error;

      try {
        await notifyInviteRevoked({
          recipientId: row.recipient_id,
          dateId: row.date_id,
          eventTitle: row.date_title || 'your date',
        });
      } catch { /* non-fatal */ }

      setRows((prev) => prev.filter((r) => r.req_id !== row.req_id));
    } catch (e: any) {
      console.error('[MySentInvites] revoke error', e);
      Alert.alert('Could not cancel invite', e?.message || 'Try again later.');
    }
  }, []);

  /* ------------------------------ guarded UI ------------------------------- */

  if (loading) {
    return (
      <AppShell headerTitle={headerTitle} showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}><ActivityIndicator /></View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell headerTitle={headerTitle} showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>You’re signed out — sent invites live here once you’re back in. 🍹</Text>
          <TouchableOpacity onPress={() => { try { navigation.navigate('Login'); } catch {} }} style={[styles.ctaBtn, { backgroundColor: DRYNKS_RED }]}>
            <Text style={styles.ctaBtnText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </AppShell>
    );
  }

  if (!rows.length) {
    return (
      <AppShell headerTitle={headerTitle} showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No sent invites yet.</Text>
          <Text style={styles.emptySub}>Invite friends from your date card, or browse dates to get started.</Text>
          <View style={styles.emptyCtasRow}>
            <TouchableOpacity onPress={goToMyDates} style={[styles.ctaBtn, { backgroundColor: DRYNKS_BLUE }]}>
              <Text style={styles.ctaBtnText}>My Dates</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goToDateFeed} style={[styles.ctaBtn, { backgroundColor: DRYNKS_RED }]}>
              <Text style={styles.ctaBtnText}>Browse Dates</Text>
            </TouchableOpacity>
          </View>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell headerTitle={headerTitle} showBack backTint="#000" currentTab="My DrYnks">
      <FlatList
        data={rows}
        keyExtractor={(it) => it.req_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24, paddingTop: 4 }}
        ListHeaderComponent={
          <View style={styles.instructions}>
            <Text style={styles.instructionsText}>
              Swipe <Text style={{ fontWeight: '800' }}>right</Text> to rescind an invite
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        initialNumToRender={6}
        windowSize={10}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <SentRow
            index={index}
            item={item}
            onRescind={rescindInvite}
            onOpenProfile={openProfile}
          />
        )}
      />
    </AppShell>
  );
};

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  emptyTitle: { fontSize: 18, color: '#222', textAlign: 'center', marginBottom: 6, fontWeight: '700' },
  emptySub: { fontSize: 14, color: '#555', textAlign: 'center', marginBottom: 14 },
  emptyCtasRow: { flexDirection: 'row', gap: 10 },

  ctaBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  instructions: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  instructionsText: { textAlign: 'center', color: '#444' },

  rowWrap: { marginBottom: 16, borderRadius: 20 },
  cardWrap: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
    }),
  },

  // DateTag aesthetics
  dateTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6E8EA',
    backgroundColor: '#FAFBFC',
  },
  dateTagAvatar: { width: 28, height: 28, borderRadius: 6, marginRight: 8, backgroundColor: '#EEE' },
  dateTagPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  dateTagEmoji: { fontSize: 16 },
  dateTagTitle: { color: DRYNKS_TEXT, fontWeight: '700' },
  dateTagSub: { color: '#6B7280', fontSize: 12, marginTop: 1 },
});

export default MySentInvitesScreen;
