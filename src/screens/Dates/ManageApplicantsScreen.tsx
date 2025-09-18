// src/screens/Dates/ManageApplicantsScreen.tsx
// Manage Applicants — production-ready
// - Shows incoming join requests for dates I host (join_requests where recipient_id = me)
// - Renders like My Sent Invites: DateTag row + applicant ProfileCard per item
// - Swipe RIGHT to accept (pending only); LEFT to decline/remove (pending or accepted)
// - Source of truth for event meta: date_requests (fallback dates)
// - Realtime on join_requests, date_requests, and dates
// - Hides native header (AppShell draws the only header)

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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

type UUID = string;

const DRYNKS_RED   = '#E34E5C';
const DRYNKS_GREEN = '#2ecc71';
const DRYNKS_BLUE  = '#232F39';
const DRYNKS_TEXT  = '#2B2B2B';
const SCREEN_W     = Dimensions.get('window').width;

/* ------------------------------ helpers ------------------------------ */

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const sumRemaining = (rgc?: Record<string, number> | null) =>
  Object.values(rgc ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

function parseMap(v: unknown): Record<string, number> | null {
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

/* ------------------------------ DB shapes ------------------------------ */

type JoinRow = {
  id: UUID;
  date_id: UUID;
  requester_id: UUID;   // applicant
  recipient_id: UUID;   // me (host)
  status: 'pending' | 'accepted' | 'cancelled' | 'dismissed' | string;
  created_at: string;
};

type DateRow = {
  id: UUID;
  title?: string | null;
  event_date?: string | null;
  event_timezone?: string | null;
  who_pays?: string | null;
  event_type?: string | null;
  orientation_preference?: string[] | null;
  profile_photo?: string | null;     // host avatar
  photo_urls?: string[] | null;      // gallery
  cover_image_url?: string | null;   // explicit cover
  creator?: UUID | null;
  creator_id?: UUID | null; user_id?: UUID | null; uid?: UUID | null;
  spots?: number | null;
  remaining_gender_counts?: any;     // jsonb | text | null
  accepted_users?: UUID[] | null;    // may exist on dates
  pending_users?: UUID[] | null;     // may exist on dates
  location?: string | null;
  location_str?: string | null;
};

type ProfileRow = {
  id: UUID;
  screenname: string | null;
  profile_photo?: string | null;
  location?: string | null;
  gender?: string | null;
  orientation?: string | string[] | null;
  about?: string | null;
  gallery_photos?: any;
};

/* ------------------------------ UI shapes ------------------------------ */

type ApplicantItem = {
  row_id: UUID;           // join_requests.id
  date_id: UUID;
  status: 'pending' | 'accepted';
  created_at: string;

  user: {
    id: UUID;
    screenname: string;
    profile_photo?: string | null;
    location?: string | null;
    gender?: string | null;
    orientation?: string | null;     // collapsed string
    about?: string | null;
    gallery_photos?: string[];
  };

  date_title: string | null;
  event_date: string | null;
  event_timezone: string | null;
  date_location: string | null;
  date_photo_url: string | null;

  creator_id: UUID | null;
  full: boolean;
  expired: boolean;
};

/* ------------------------------ Row component ------------------------------ */

type RowProps = {
  index: number;
  item: ApplicantItem;
  onAccept: (row: ApplicantItem) => void;
  onDeclineOrRemove: (row: ApplicantItem) => void;
  onOpenProfile: (userId: string) => void;
};

const ApplicantRow = React.memo<RowProps>(({ index, item, onAccept, onDeclineOrRemove, onOpenProfile }) => {
  const tx = useSharedValue(0);
  const threshold = Math.min(140, SCREEN_W * 0.33);

  const pan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onStart(() => { tx.value = 0; })
    .onUpdate((e) => { tx.value = e.translationX; })
    .onEnd((e) => {
      if (e.translationX > threshold && item.status === 'pending') {
        tx.value = withSpring(SCREEN_W, {}, () => runOnJS(onAccept)(item));
      } else if (e.translationX < -threshold) {
        tx.value = withSpring(-SCREEN_W, {}, () => runOnJS(onDeclineOrRemove)(item));
      } else {
        tx.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const bgStyle   = useAnimatedStyle(() => ({
    backgroundColor:
      tx.value > 0 ? 'rgba(46,204,113,0.12)' :
      tx.value < 0 ? 'rgba(227,78,92,0.10)' : 'transparent',
  }));

  const day = formatEventDay(item.event_date, item.event_timezone);
  const disabled = item.expired || item.full;

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
                  {day || 'Upcoming'}{item.date_location ? ` · ${item.date_location}` : ''}
                </Text>
              </View>

              {/* Status pill */}
              <View style={[
                styles.statusPill,
                item.status === 'accepted' ? styles.pillAccepted : styles.pillPending
              ]}>
                <Text style={styles.pillText}>{item.status === 'accepted' ? 'Accepted' : 'Pending'}</Text>
              </View>
            </View>

            {/* --- Applicant Profile --- */}
            <ProfileCard
              user={item.user}
              compact
              origin="ManageApplicants"
              invited={item.status === 'accepted'} // visually subtle; main action is swipe
              onInvite={() => { if (item.status === 'pending') onAccept(item); }}
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

const ManageApplicantsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  useLayoutEffect(() => { navigation.setOptions?.({ headerShown: false }); }, [navigation]);

  const [me, setMe] = useState<UUID | null>(null);
  const [rows, setRows] = useState<ApplicantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // realtime
  const chJRRef   = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDRRef   = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDatesRef= useRef<ReturnType<typeof supabase.channel> | null>(null);

  // session
  useEffect(() => {
    (async () => {
      const [{ data: sess }, { data: user }] = await Promise.all([
        supabase.auth.getSession(), supabase.auth.getUser()
      ]);
      setMe(sess?.session?.user?.id ?? user?.user?.id ?? null);
    })();
  }, []);

  const detachRealtime = useCallback(() => {
    try { chJRRef.current?.unsubscribe(); } catch {}
    try { chDRRef.current?.unsubscribe(); } catch {}
    try { chDatesRef.current?.unsubscribe(); } catch {}
    chJRRef.current = chDRRef.current = chDatesRef.current = null;
  }, []);

  /* --------------------------- fetch helpers --------------------------- */

  const fetchDateRequestsMap = useCallback(async (ids: UUID[]) => {
    const map = new Map<UUID, DateRow>();
    if (!ids.length) return map;

    // prefer date_requests
    let list: any[] = [];
    try {
      const { data } = await supabase.from('date_requests').select('*').in('id', ids);
      if (Array.isArray(data)) list = data;
    } catch {/* ignore */}

    // fallback for missing
    const found = new Set(list.map(r => r.id));
    const missing = ids.filter(id => !found.has(id));
    if (missing.length) {
      const { data: d2 } = await supabase.from('dates').select('*').in('id', missing);
      if (Array.isArray(d2)) list = list.concat(d2);
    }

    list.forEach((r: any) => map.set(r.id, r as DateRow));
    return map;
  }, []);

  const fetchProfilesMap = useCallback(async (ids: UUID[]) => {
    const map = new Map<UUID, ProfileRow>();
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length) return map;
    const { data } = await supabase
      .from('profiles')
      .select('id, screenname, profile_photo, location, gender, orientation, about, gallery_photos')
      .in('id', uniq);
    (data || []).forEach((row: any) => map.set(row.id, row));
    return map;
  }, []);

  const fetchAcceptedCounts = useCallback(async (ids: UUID[]) => {
    const counts = new Map<UUID, number>();
    if (!ids.length) return counts;
    // accepted joiners are tracked in join_requests with status 'accepted'
    const { data } = await supabase
      .from('join_requests')
      .select('date_id')
      .eq('status', 'accepted')
      .in('date_id', ids);
    (data || []).forEach((r: any) => {
      counts.set(r.date_id, (counts.get(r.date_id) ?? 0) + 1);
    });
    return counts;
  }, []);

  /* ------------------------------ main fetch ------------------------------ */

  const fetchApplicants = useCallback(async (uid?: UUID | null) => {
    const host = (uid ?? me) as UUID | null;
    if (!host) { setRows([]); setLoading(false); setRefreshing(false); return; }
    if (!refreshing) setLoading(true);

    // pending + accepted: we allow removal after acceptance
    const { data, error } = await supabase
      .from('join_requests')
      .select('id,date_id,requester_id,recipient_id,status,created_at')
      .eq('recipient_id', host)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ManageApplicants] fetch error', error);
      setRows([]); setLoading(false); setRefreshing(false);
      return;
    }

    const jrs = (data || []) as JoinRow[];
    if (!jrs.length) {
      setRows([]); setLoading(false); setRefreshing(false);
      detachRealtime();
      return;
    }

    const dateIds = Array.from(new Set(jrs.map(r => r.date_id)));
    const userIds = Array.from(new Set(jrs.map(r => r.requester_id)));

    const [eventMap, profileMap, acceptedCounts] = await Promise.all([
      fetchDateRequestsMap(dateIds),
      fetchProfilesMap(userIds),
      fetchAcceptedCounts(dateIds),
    ]);

    // build items
    const built: ApplicantItem[] = jrs.map((r) => {
      const d = eventMap.get(r.date_id) as DateRow | undefined;
      const p = profileMap.get(r.requester_id) as ProfileRow | undefined;

      // ProfileCard expects a collapsed orientation string
      const collapsedOrient = Array.isArray(p?.orientation)
        ? (p?.orientation[0] as string | undefined)
        : (p?.orientation as string | undefined);

      const user = {
        id: r.requester_id,
        screenname: p?.screenname ?? 'Guest',
        profile_photo: p?.profile_photo ?? null,
        location: p?.location ?? undefined,
        gender: p?.gender ?? null,
        orientation: collapsedOrient ?? null,
        about: p?.about ?? null,
        gallery_photos: Array.isArray(p?.gallery_photos) ? (p?.gallery_photos as string[]) : [],
      };

      // date small cover
      let datePhoto: string | null = null;
      if ((d as any)?.cover_image_url) datePhoto = String((d as any).cover_image_url);
      else if (Array.isArray(d?.photo_urls) && d!.photo_urls!.length) datePhoto = String(d!.photo_urls![0]);
      else if (d?.profile_photo) datePhoto = String(d.profile_photo);

      const cleanLoc =
        (d?.location && !looksLikeWKTOrHex(d.location) ? d.location : null) ||
        (d as any)?.location_str ||
        null;

      // compute "full" like feed logic
      let full = false;
      const rgc = parseMap(d?.remaining_gender_counts);
      if (rgc && Object.keys(rgc).length > 0) {
        const total = sumRemaining(rgc);
        if (Number.isFinite(total)) full = (total as number) <= 0;
      } else if (typeof d?.spots === 'number') {
        const acceptedOnDate = acceptedCounts.get(r.date_id) ?? 0;
        full = acceptedOnDate >= (d?.spots ?? 0);
      }

      // Expiry: end-of-day in event timezone (optional; we keep stale rows visible to manage)
      const expired = false; // hosts might still want to review/clean up; keep visible

      return {
        row_id: r.id,
        date_id: r.date_id,
        status: (r.status === 'accepted' ? 'accepted' : 'pending') as 'accepted' | 'pending',
        created_at: r.created_at,

        user,

        date_title: (d?.title ?? d?.event_type ?? null) as string | null,
        event_date: (d?.event_date ?? null) as string | null,
        event_timezone: ((d as any)?.event_timezone ?? null) as string | null,
        date_location: cleanLoc,
        date_photo_url: datePhoto,

        creator_id: ((d?.creator_id ?? d?.creator ?? d?.user_id ?? d?.uid) ?? null) as UUID | null,

        full,
        expired,
      } as ApplicantItem;
    });

    // sort: newest first (keep stable by created_at)
    built.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

    setRows(built);
    setLoading(false);
    setRefreshing(false);

    // realtime bindings for these ids
    attachRealtime(host, dateIds);
  }, [me, refreshing, fetchDateRequestsMap, fetchProfilesMap, fetchAcceptedCounts, detachRealtime]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchApplicants();
  }, [fetchApplicants]);

  /* ------------------------------ realtime ------------------------------ */

  const attachRealtime = useCallback((hostId: UUID, dateIds: UUID[]) => {
    detachRealtime();

    // join_requests for me (host)
    chJRRef.current = supabase
      .channel('rx_manage_applicants_jr_self')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'join_requests', filter: `recipient_id=eq.${hostId}` },
        async (payload) => {
          const r = payload?.new as JoinRow | undefined;
          if (!r || (r.status !== 'pending' && r.status !== 'accepted')) return;
          // build 1 row for the new item
          const [events, profiles] = await Promise.all([
            fetchDateRequestsMap([r.date_id]),
            fetchProfilesMap([r.requester_id]),
          ]);
          const counts = await fetchAcceptedCounts([r.date_id]);
          const tmp = await (async () => {
            const d = events.get(r.date_id) as DateRow | undefined;
            const p = profiles.get(r.requester_id) as ProfileRow | undefined;
            if (!d || !p) return null;

            const collapsedOrient = Array.isArray(p?.orientation)
              ? (p?.orientation[0] as string | undefined)
              : (p?.orientation as string | undefined);

            let datePhoto: string | null = null;
            if ((d as any)?.cover_image_url) datePhoto = String((d as any).cover_image_url);
            else if (Array.isArray(d?.photo_urls) && d!.photo_urls!.length) datePhoto = String(d!.photo_urls![0]);
            else if (d?.profile_photo) datePhoto = String(d.profile_photo);

            const cleanLoc =
              (d?.location && !looksLikeWKTOrHex(d.location) ? d.location : null) ||
              (d as any)?.location_str ||
              null;

            let full = false;
            const rgc = parseMap(d?.remaining_gender_counts);
            if (rgc && Object.keys(rgc).length > 0) {
              const total = sumRemaining(rgc);
              if (Number.isFinite(total)) full = (total as number) <= 0;
            } else if (typeof d?.spots === 'number') {
              const acceptedOnDate = counts.get(r.date_id) ?? 0;
              full = acceptedOnDate >= (d?.spots ?? 0);
            }

            return {
              row_id: r.id,
              date_id: r.date_id,
              status: (r.status === 'accepted' ? 'accepted' : 'pending') as 'accepted' | 'pending',
              created_at: r.created_at,
              user: {
                id: r.requester_id,
                screenname: p?.screenname ?? 'Guest',
                profile_photo: p?.profile_photo ?? null,
                location: p?.location ?? undefined,
                gender: p?.gender ?? null,
                orientation: collapsedOrient ?? null,
                about: p?.about ?? null,
                gallery_photos: Array.isArray(p?.gallery_photos) ? (p?.gallery_photos as string[]) : [],
              },
              date_title: (d?.title ?? d?.event_type ?? null) as string | null,
              event_date: (d?.event_date ?? null) as string | null,
              event_timezone: ((d as any)?.event_timezone ?? null) as string | null,
              date_location: cleanLoc,
              date_photo_url: datePhoto,
              creator_id: ((d?.creator_id ?? d?.creator ?? d?.user_id ?? d?.uid) ?? null) as UUID | null,
              full,
              expired: false,
            } as ApplicantItem;
          })();

          if (tmp) {
            setRows(prev => {
              if (prev.some(x => x.row_id === tmp.row_id)) return prev;
              return [tmp, ...prev];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'join_requests', filter: `recipient_id=eq.${hostId}` },
        (payload) => {
          const next = payload?.new as JoinRow | undefined;
          if (!next) return;
          setRows(prev => {
            const idx = prev.findIndex(x => x.row_id === next.id);
            if (idx < 0) return prev;
            // remove when requester cancels or host dismisses; keep when accepted
            if (next.status === 'pending' || next.status === 'accepted') {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], status: next.status === 'accepted' ? 'accepted' : 'pending', created_at: next.created_at };
              return copy;
            }
            return prev.filter(x => x.row_id === next.id ? false : true);
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'join_requests', filter: `recipient_id=eq.${hostId}` },
        (payload) => {
          const old = payload?.old as JoinRow | undefined;
          if (!old) return;
          setRows(prev => prev.filter(x => x.row_id !== old.id));
        }
      )
      .subscribe(() => {});

    if (dateIds.length) {
      const idList = dateIds.join(',');

      chDRRef.current = supabase
        .channel('rx_manage_applicants_date_requests')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'date_requests', filter: `id=in.(${idList})` },
          () => { fetchApplicants(hostId); }
        )
        .subscribe(() => {});

      chDatesRef.current = supabase
        .channel('rx_manage_applicants_dates')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'dates', filter: `id=in.(${idList})` },
          () => { fetchApplicants(hostId); }
        )
        .subscribe(() => {});
    }
  }, [detachRealtime, fetchApplicants, fetchDateRequestsMap, fetchProfilesMap, fetchAcceptedCounts]);

  useEffect(() => {
    (async () => { await fetchApplicants(); })();
    return () => detachRealtime();
  }, [fetchApplicants, detachRealtime]);

  useFocusEffect(React.useCallback(() => { fetchApplicants(); return () => {}; }, [fetchApplicants]));

  /* ------------------------------ actions ------------------------------ */

  const updateDateMembership = useCallback(
    async (date_id: string, user_id: string, opts: { accept?: boolean; previousAccepted?: boolean; gender?: string | null }) => {
      // best-effort: maintain arrays & capacity where present
      try {
        const { data: d, error } = await supabase
          .from('dates')
          .select('pending_users, accepted_users, remaining_gender_counts')
          .eq('id', date_id)
          .maybeSingle();
        if (error || !d) return;

        const pending: string[] = Array.isArray(d.pending_users) ? d.pending_users : [];
        const accepted: string[] = Array.isArray(d.accepted_users) ? d.accepted_users : [];

        let nextPending = pending.filter((id) => id !== user_id);
        let nextAccepted = accepted.slice();

        const rgc = { ...(d.remaining_gender_counts || {}) } as Record<string, number>;

        if (opts.accept) {
          if (!nextAccepted.includes(user_id)) nextAccepted.push(user_id);
          const g = opts.gender || '';
          if (g && typeof rgc[g] === 'number' && rgc[g] > 0) rgc[g] = rgc[g] - 1;
        } else {
          // decline or remove
          nextAccepted = nextAccepted.filter((id) => id !== user_id);
          // if removing an already-accepted guest, free 1 slot back to their bucket
          if (opts.previousAccepted) {
            const g = opts.gender || '';
            if (g && typeof rgc[g] === 'number') rgc[g] = Math.max(0, rgc[g] + 1);
          }
        }

        await supabase
          .from('dates')
          .update({
            pending_users: nextPending,
            accepted_users: nextAccepted,
            remaining_gender_counts: rgc,
          })
          .eq('id', date_id);
      } catch {/* non-fatal */}
    },
    []
  );

  const acceptApplicant = useCallback(async (row: ApplicantItem) => {
    try {
      const { error } = await supabase
        .from('join_requests')
        .update({ status: 'accepted' })
        .eq('id', row.row_id);
      if (error) throw error;

      // best-effort sync to dates table (capacity/etc.)
      await updateDateMembership(row.date_id, row.user.id, {
        accept: true,
        gender: row.user.gender ?? null,
      });

      setRows((prev) =>
        prev.map((r) => (r.row_id === row.row_id ? { ...r, status: 'accepted' } : r))
      );
    } catch (e: any) {
      console.error('[ManageApplicants] accept error', e);
      Alert.alert('Could not accept', e?.message || 'Try again later.');
    }
  }, [updateDateMembership]);

  const declineOrRemove = useCallback(async (row: ApplicantItem) => {
    try {
      const { error } = await supabase
        .from('join_requests')
        .update({ status: 'dismissed' })
        .eq('id', row.row_id);
      if (error) throw error;

      await updateDateMembership(row.date_id, row.user.id, {
        accept: false,
        previousAccepted: row.status === 'accepted',
        gender: row.user.gender ?? null,
      });

      setRows((prev) => prev.filter((r) => r.row_id !== row.row_id));
    } catch (e: any) {
      console.error('[ManageApplicants] decline/remove error', e);
      Alert.alert('Could not update request', e?.message || 'Try again later.');
    }
  }, [updateDateMembership]);

  const openProfile = useCallback((userId: string) => {
    try { navigation.navigate('PublicProfile' as never, { userId, origin: 'ManageApplicants' } as never); }
    catch {}
  }, [navigation]);

  /* ------------------------------ guarded UI ------------------------------ */

  if (loading) {
    return (
      <AppShell headerTitle="Manage Applicants" showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}><ActivityIndicator /></View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell headerTitle="Manage Applicants" showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Sign in to manage your applicants.</Text>
        </View>
      </AppShell>
    );
  }

  if (!rows.length) {
    return (
      <AppShell headerTitle="Manage Applicants" showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No applicants… yet.</Text>
          <Text style={styles.emptySub}>Throw a date and watch the RSVPs roll in. 🎣</Text>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell headerTitle="Manage Applicants" showBack backTint="#000" currentTab="My DrYnks">
      <FlatList
        data={rows}
        keyExtractor={(it) => it.row_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24, paddingTop: 4 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
            <Text style={{ textAlign: 'center', color: '#444' }}>
              Swipe <Text style={{ fontWeight: '800', color: DRYNKS_RED }}>← Left</Text> to
              {' '}decline/remove • <Text style={{ fontWeight: '800', color: DRYNKS_GREEN }}>Right →</Text> to accept
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        initialNumToRender={8}
        windowSize={12}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <ApplicantRow
            index={index}
            item={item}
            onAccept={acceptApplicant}
            onDeclineOrRemove={declineOrRemove}
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
  emptySub: { fontSize: 14, color: '#555', textAlign: 'center' },

  rowWrap: { marginBottom: 16, borderRadius: 20 },
  cardWrap: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
    }),
  },

  // DateTag styles
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

  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginLeft: 8 },
  pillPending:  { backgroundColor: '#E7EBF0' },
  pillAccepted: { backgroundColor: '#E8FAEF' },
  pillText:     { fontSize: 12, fontWeight: '700', color: '#23303A' },

  emptyText: { fontSize: 16, color: '#666', textAlign: 'center' },
});

export default ManageApplicantsScreen;
