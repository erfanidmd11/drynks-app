// src/screens/Dates/JoinRequestsScreen.tsx
// Production-ready (feed-parity visuals, realtime, gesture-safe).
// Shows *my* pending join requests. I can cancel (swipe ← or button).
//
// Backend assumptions (from your SQL):
// - Table: public.join_requests (requester_id, recipient_id, date_id, status ...)
// - On host acceptance/decline, join_requests.status updates away from 'pending'.
// - Acceptance adds me to public.event_attendees and ensures chat membership.
// - Date cancellations delete the row from public.dates (handled here via realtime).

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
  Dimensions,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInUp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';

type UUID = string;

const DRYNKS_RED   = '#E34E5C';
const DRYNKS_BLUE  = '#232F39';
const DRYNKS_TEXT  = '#2B2B2B';
const SCREEN_W     = Dimensions.get('window').width;

/* ----------------------------- helpers ----------------------------- */
const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const sumRemaining = (rgc?: any): number => {
  if (!rgc) return 0;
  if (typeof rgc === 'string') {
    try { rgc = JSON.parse(rgc); } catch { return 0; }
  }
  if (typeof rgc !== 'object') return 0;
  return Object.values(rgc).reduce(
    (a: number, b: any) => a + (typeof b === 'number' ? b : Number(b) || 0),
    0
  );
};

/* ------------------------------ DB shapes ----------------------------- */
type JoinRow = {
  id: UUID;
  status: 'pending' | 'accepted' | 'cancelled' | 'dismissed' | 'removed_by_host' | string;
  requester_id: UUID;
  recipient_id: UUID; // host (pinned by trigger)
  date_id: UUID;
  created_at: string;
};

type FeedBase = {
  id: UUID;
  creator: UUID;
  title?: string | null;
  event_type: string | null;
  event_date: string | null;
  location: string | null;
  created_at: string | null;
  accepted_users: UUID[] | null;
  orientation_preference: string[] | null;
  spots: number | null;
  remaining_gender_counts: Record<string, number> | null;
  photo_urls: string[] | null;
  profile_photo: string | null;   // host avatar
  date_cover?: string | null;     // v2 only
  creator_photo?: string | null;  // v2 only
};

type ProfileLite = {
  id: UUID;
  screenname: string | null;
  profile_photo: string | null;
  gender?: string | null;
  location?: string | null;
  birthdate?: string | null;
  preferences?: any;
};

type WhoPaysLite = { who_pays: string | null; event_timezone: string | null };

type JoinItem = {
  req_id: UUID;
  date_id: UUID;
  created_at: string;

  // DateCard shape
  title: string | null;
  event_date: string | null;
  event_timezone: string | null;
  location: string | null;
  who_pays: string | null;
  event_type: string | null;
  orientation_preference: string[] | null;
  spots: number | null;
  remaining_gender_counts: Record<string, number> | null;

  creator_id: UUID;
  creator_profile: ProfileLite | null;

  profile_photo: string | null; // host avatar
  photo_urls: string[];         // event photos only
  cover_image_url: string | null;
};

/* --------------------------- table detection -------------------------- */
async function detectJoinRequests(viewer: UUID): Promise<'join_requests' | null> {
  const { error } = await supabase
    .from('join_requests')
    .select('id, requester_id, recipient_id, status, date_id, created_at')
    .eq('requester_id', viewer)
    .limit(1);
  return error ? null : 'join_requests';
}

/* --------------------------- feed helpers --------------------------- */
async function fetchFeedRowsFor(dateIds: UUID[]): Promise<FeedBase[]> {
  if (!dateIds.length) return [];
  // Try v2 first
  try {
    const { data, error } = await supabase
      .from('vw_feed_dates_v2')
      .select(`
        id, creator, title, event_type, event_date, location, created_at,
        accepted_users, orientation_preference, spots, remaining_gender_counts,
        photo_urls, profile_photo, date_cover, creator_photo
      `)
      .in('id', dateIds);
    if (error) throw error;
    if (Array.isArray(data) && data.length) return data as FeedBase[];
  } catch { /* fall through */ }

  // Fallback to v1
  const { data } = await supabase
    .from('vw_feed_dates')
    .select(`
      id, creator, event_type, event_date, location, created_at,
      accepted_users, orientation_preference, spots, remaining_gender_counts,
      photo_urls, profile_photo
    `)
    .in('id', dateIds);
  return (data || []) as FeedBase[];
}

async function fetchProfilesMap(ids: UUID[]): Promise<Map<UUID, ProfileLite>> {
  const map = new Map<UUID, ProfileLite>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return map;
  const { data } = await supabase
    .from('profiles')
    .select('id, screenname, profile_photo, gender, location, birthdate, preferences')
    .in('id', uniq as UUID[]);
  (data || []).forEach((p: any) => map.set(p.id, p as ProfileLite));
  return map;
}

async function fetchWhoPaysMap(dateIds: UUID[]): Promise<Map<UUID, WhoPaysLite>> {
  const out = new Map<UUID, WhoPaysLite>();
  if (!dateIds.length) return out;

  // Prefer dates (if present) else fallback to date_requests
  try {
    const { data } = await supabase.from('dates').select('id, who_pays, event_timezone').in('id', dateIds);
    (data || []).forEach((r: any) => out.set(r.id, { who_pays: r.who_pays ?? null, event_timezone: r.event_timezone ?? null }));
  } catch {}

  const missing = dateIds.filter(id => !out.has(id));
  if (missing.length) {
    const { data } = await supabase.from('date_requests').select('id, who_pays, event_timezone').in('id', missing);
    (data || []).forEach((r: any) => out.set(r.id, { who_pays: r.who_pays ?? null, event_timezone: r.event_timezone ?? null }));
  }

  return out;
}

/* --------------------------- Row (card) ---------------------------- */
type RowProps = {
  index: number;
  me: string;
  item: JoinItem;
  onCancel: (row: JoinItem) => void;
};

const RowItem = React.memo<RowProps>(({ index, me, item, onCancel }) => {
  const navigation = useNavigation<any>();
  const tx = useSharedValue(0);
  const threshold = Math.min(140, SCREEN_W * 0.30);

  // Let DateCard's internal FlatList receive horizontal swipes
  const nativeScroll = Gesture.Native();

  const pan = Gesture.Pan()
    .activeOffsetX([-40, 40])
    .failOffsetY([-12, 12])
    .simultaneousWithExternalGesture(nativeScroll)
    .onStart(() => { tx.value = 0; })
    .onUpdate((e) => { tx.value = e.translationX; })
    .onEnd((e) => {
      if (e.translationX < -threshold) {
        tx.value = withSpring(-SCREEN_W, {}, () => runOnJS(onCancel)(item));
      } else {
        tx.value = withSpring(0);
      }
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const remaining = sumRemaining(item.remaining_gender_counts);
  const expired = (() => {
    const iso = item.event_date;
    if (!iso) return false;
    const d = new Date(iso);
    return Number.isFinite(d.valueOf()) ? d < new Date() : false;
  })();

  const disabled = expired || (Number.isFinite(remaining) && remaining <= 0);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View entering={FadeInUp.delay(index * 50).duration(300)} style={styles.rowWrap}>
        {/* Status + explicit Cancel for accessibility */}
        <View style={styles.headRow}>
          <Text style={styles.statusPill}>Pending</Text>
          <TouchableOpacity onPress={() => onCancel(item)} style={styles.cancelChip} accessibilityRole="button">
            <Ionicons name="close-circle-outline" size={16} color="#991B1B" />
            <Text style={styles.cancelText}>Cancel Request</Text>
          </TouchableOpacity>
        </View>

        <Animated.View style={rowStyle}>
          <GestureDetector gesture={nativeScroll}>
            <View>
              <DateCard
                date={{
                  id: item.date_id,
                  title: item.title ?? undefined,
                  event_date: item.event_date ?? undefined,
                  event_timezone: item.event_timezone ?? undefined,
                  location: item.location ?? undefined,

                  creator_id: item.creator_id,
                  creator_profile: item.creator_profile ?? undefined,
                  accepted_profiles: [],

                  who_pays: item.who_pays ?? undefined,
                  event_type: item.event_type ?? undefined,
                  orientation_preference: item.orientation_preference ?? undefined,
                  spots: item.spots ?? undefined,
                  remaining_gender_counts: item.remaining_gender_counts ?? undefined,

                  // FEED-PARITY GALLERY: cover + event photos; host avatar via profile_photo
                  profile_photo: item.profile_photo ?? undefined,    // host avatar (fallback)
                  photo_urls: item.photo_urls ?? undefined,          // event photos ONLY
                  cover_image_url: item.cover_image_url ?? undefined,
                }}
                userId={me}
                isCreator={false}
                isAccepted={false}
                disabled={!!disabled}
                disableFooterCtas
                // IMPORTANT: avoid onPressCard; deep-link to host profile is still available
                onPressProfile={(pid) =>
                  navigation.navigate('PublicProfile', { userId: pid, origin: 'JoinRequests' })
                }
              />
            </View>
          </GestureDetector>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

/* ------------------------------ Screen ------------------------------ */

const JoinRequestsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  useLayoutEffect(() => { navigation.setOptions?.({ headerShown: false }); }, [navigation]);

  const [me, setMe] = useState<UUID | null>(null);
  const [rows, setRows] = useState<JoinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tableReady, setTableReady] = useState<boolean>(true);

  // realtime channels
  const chReqRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDatesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const detachRealtime = useCallback(() => {
    try { chReqRef.current?.unsubscribe(); } catch {}
    try { chDatesRef.current?.unsubscribe(); } catch {}
    chReqRef.current = null; chDatesRef.current = null;
  }, []);

  /** Build DateCard items from feed rows + profiles + whoPays map */
  const buildItems = useCallback((
    joinRows: JoinRow[],
    feedById: Map<UUID, FeedBase>,
    profiles: Map<UUID, ProfileLite>,
    whoPaysMap: Map<UUID, WhoPaysLite>
  ): JoinItem[] => {
    return joinRows.map((jr) => {
      const r = feedById.get(jr.date_id);
      if (!r) return null as any;

      // Host: prefer feed.creator; fallback to pinned recipient_id
      const hostId = (r.creator || jr.recipient_id) as UUID;
      let creator_profile = profiles.get(hostId) || null;

      // Host avatar: profile beats feed fallback
      const hostAvatar = creator_profile?.profile_photo || (r as any).creator_photo || r.profile_photo || null;

      // If we have an avatar but not a full profile, synthesize minimal
      if (!creator_profile && hostAvatar) {
        creator_profile = {
          id: hostId,
          screenname: null,
          profile_photo: hostAvatar,
          gender: null,
          location: null,
          birthdate: null,
          preferences: null,
        };
      }

      // Location tidy (avoid WKT)
      const cleanLoc = !looksLikeWKTOrHex(r.location)
        ? r.location
        : (creator_profile?.location ?? null);

      // Cover for tag + first slide (prefer date_cover)
      const cover =
        (r as any).date_cover ||
        (Array.isArray(r.photo_urls) && r.photo_urls[0]) ||
        r.profile_photo ||
        (r as any).creator_photo ||
        creator_profile?.profile_photo ||
        null;

      // Event photo list (no host avatar here)
      const photo_urls: string[] =
        Array.isArray(r.photo_urls) && r.photo_urls.length
          ? r.photo_urls
          : (cover ? [cover] : []);

      const wp = whoPaysMap.get(r.id) || { who_pays: null, event_timezone: null };

      return {
        req_id: jr.id,
        date_id: r.id,
        created_at: jr.created_at,

        title: (r as any).title ?? r.event_type ?? null, // nicer tag title
        event_date: r.event_date ?? null,
        event_timezone: wp.event_timezone ?? null,
        location: cleanLoc ?? null,
        who_pays: wp.who_pays ?? null,
        event_type: r.event_type ?? null,
        orientation_preference: Array.isArray(r.orientation_preference) ? r.orientation_preference : null,
        spots: r.spots ?? null,
        remaining_gender_counts: (r.remaining_gender_counts as any) ?? null,

        creator_id: hostId,
        creator_profile,

        profile_photo: hostAvatar,
        photo_urls,
        cover_image_url: cover,
      } as JoinItem;
    }).filter(Boolean) as JoinItem[];
  }, []);

  const attachRealtime = useCallback(
    (viewer: UUID, dateIds: UUID[]) => {
      detachRealtime();

      // join_requests changes (INSERT/UPDATE/DELETE) for me
      chReqRef.current = supabase
        .channel('join_requests_my_rows')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'join_requests', filter: `requester_id=eq.${viewer}` },
          async (payload: any) => {
            const jr = payload?.new as JoinRow | undefined;
            if (!jr || jr.status !== 'pending') return;

            // Load feed row + host profile + whoPays for this one date
            const [feedRows, whoPaysMap] = await Promise.all([
              fetchFeedRowsFor([jr.date_id]),
              fetchWhoPaysMap([jr.date_id]),
            ]);

            if (!feedRows.length) return;
            const feed = feedRows[0];
            const hostId = (feed.creator || jr.recipient_id) as UUID;

            const profilesMap = await fetchProfilesMap([hostId]);
            const items = buildItems([jr], new Map([[feed.id, feed]]), profilesMap, whoPaysMap);
            if (!items.length) return;
            const item = items[0];

            setRows((prev) => (prev.some((r) => r.req_id === item.req_id) ? prev : [item, ...prev]));
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'join_requests', filter: `requester_id=eq.${viewer}` },
          (payload: any) => {
            const next = payload?.new as JoinRow | undefined;
            if (!next) return;
            if (next.status !== 'pending') {
              setRows((prev) => prev.filter((r) => r.req_id !== next.id));
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'join_requests', filter: `requester_id=eq.${viewer}` },
          (payload: any) => {
            const old = payload?.old as JoinRow | undefined;
            if (!old) return;
            setRows((prev) => prev.filter((r) => r.req_id !== old.id));
          }
        )
        .subscribe(() => {});

      // Dates watch (capacity / deletion) — table-level events (views don’t emit realtime)
      if (dateIds.length) {
        const idList = dateIds.join(',');
        chDatesRef.current = supabase
          .channel('join_requests_dates_watch')
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'dates', filter: `id=in.(${idList})` },
            (payload: any) => {
              const d = payload?.new as any;
              const remaining = sumRemaining(d?.remaining_gender_counts ?? d?.preferred_gender_counts);
              if (Number.isFinite(remaining) && remaining <= 0) {
                setRows((prev) => prev.filter((r) => r.date_id !== d.id));
              }
            }
          )
          .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'dates', filter: `id=in.(${idList})` },
            (payload: any) => {
              const old = payload?.old as any;
              if (old?.id) setRows((prev) => prev.filter((r) => r.date_id !== old.id));
            }
          )
          .subscribe(() => {});
      }
    },
    [detachRealtime, buildItems]
  );

  const fetchRows = useCallback(
    async (uid?: UUID | null) => {
      const viewer = (uid ?? me) as UUID | null;
      if (!viewer) {
        setRows([]); setLoading(false); setRefreshing(false);
        detachRealtime();
        return;
      }

      if (!refreshing) setLoading(true);

      const table = await detectJoinRequests(viewer);
      const ready = !!table;
      setTableReady(ready);
      if (!ready) {
        setRows([]); setLoading(false); setRefreshing(false);
        detachRealtime();
        return;
      }

      // 1) My pending join requests
      const { data, error } = await supabase
        .from('join_requests')
        .select('id, status, requester_id, recipient_id, date_id, created_at')
        .eq('requester_id', viewer)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[JoinRequests] fetch rows error', error);
        setRows([]); setLoading(false); setRefreshing(false);
        return;
      }

      const joinRows = (data || []) as JoinRow[];
      if (!joinRows.length) {
        setRows([]); setLoading(false); setRefreshing(false);
        attachRealtime(viewer, []);
        return;
      }

      const dateIds = Array.from(new Set(joinRows.map((r) => r.date_id)));

      // 2) Feed rows (same as Date Feed / Received Invites)
      const feedRows = await fetchFeedRowsFor(dateIds);
      const feedById = new Map(feedRows.map((r) => [r.id, r]));

      // 3) Enrichment: who_pays/timezone + profiles (creators ∪ recipients)
      const whoPaysMap = await fetchWhoPaysMap(dateIds);

      const creatorIds = feedRows.map((r) => r.creator).filter(Boolean) as UUID[];
      const recipientIds = joinRows.map((r) => r.recipient_id);
      const profilesMap = await fetchProfilesMap([...creatorIds, ...recipientIds]);

      // 4) Build items in feed-parity shape
      const items = buildItems(joinRows, feedById, profilesMap, whoPaysMap);
      setRows(items);
      setLoading(false);
      setRefreshing(false);

      attachRealtime(viewer, dateIds);
    },
    [me, refreshing, attachRealtime, detachRealtime, buildItems]
  );

  const onRefresh = useCallback(() => { setRefreshing(true); fetchRows(); }, [fetchRows]);

  // bootstrap + cleanup
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id as UUID | undefined;
      setMe(uid ?? null);
      await fetchRows(uid ?? null);
    })();
    return () => detachRealtime();
  }, [fetchRows, detachRealtime]);

  // focus refresh
  useFocusEffect(React.useCallback(() => { fetchRows(); return () => {}; }, [fetchRows]));

  /* ------------------------------ actions ------------------------------ */
  const cancelRequest = useCallback(
    async (row: JoinItem) => {
      if (!tableReady) {
        Alert.alert('Not available', 'Join requests are not enabled in this environment yet.');
        return;
      }
      try {
        const { error } = await supabase
          .from('join_requests')
          .update({ status: 'cancelled' })
          .eq('id', row.req_id);
        if (error) throw error;

        // optimistic remove
        setRows((prev) => prev.filter((r) => r.req_id !== row.req_id));

        // clear local "requested_<dateId>" so the button resets elsewhere
        try { await AsyncStorage.removeItem(`requested_${row.date_id}`); } catch {}

        // optional: notify host
        try {
          await supabase.from('notifications').insert([{
            user_id: row.creator_id,
            message: `Request rescinded for "${row.title ?? 'a date'}"`,
            screen: 'MyDates',
            params: { date_id: row.date_id, req_id: row.req_id },
          }]);
        } catch {}
      } catch (e: any) {
        console.error('[JoinRequests] cancel error', e);
        Alert.alert('Error', e?.message || 'Could not cancel your request.');
      }
    },
    [tableReady]
  );

  /* ------------------------------- UI branches ------------------------------ */

  if (loading) {
    return (
      <AppShell headerTitle="My Join Requests" showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: '#666' }}>Loading your join requests…</Text>
        </View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell headerTitle="My Join Requests" showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>You’re incognito—sign in to see your join requests. 🕵️‍♀️</Text>
        </View>
      </AppShell>
    );
  }

  if (!tableReady) {
    return (
      <AppShell headerTitle="My Join Requests" showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Join requests aren’t enabled in this environment yet.</Text>
        </View>
      </AppShell>
    );
  }

  if (!rows.length) {
    return (
      <AppShell headerTitle="My Join Requests" showBack backTint="#000" currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No join requests on the board. Your social calendar is chilling on ice. 🧊
          </Text>
        </View>
      </AppShell>
    );
  }

  /* ---------------------------------- main ---------------------------------- */

  return (
    <AppShell headerTitle="My Join Requests" showBack backTint="#000" currentTab="My DrYnks">
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 }}>
        <Text style={{ textAlign: 'center', color: '#666' }}>
          Swipe <Text style={{ fontWeight: '800', color: DRYNKS_RED }}>← Left</Text> to cancel your request
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(it) => it.req_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        initialNumToRender={6}
        windowSize={10}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <RowItem index={index} me={me!} item={item} onCancel={cancelRequest} />
        )}
      />
    </AppShell>
  );
};

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#555', fontSize: 16, textAlign: 'center' },

  rowWrap: { marginBottom: 16, borderRadius: 20 },

  headRow: {
    marginBottom: 6,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  statusPill: {
    backgroundColor: '#E7EBF0',
    color: '#23303A',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },

  cancelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Platform.select({ ios: '#FFF1F2', android: '#FFE4E6', default: '#FFE4E6' }),
  },
  cancelText: { color: '#991B1B', fontSize: 12, fontWeight: '700' },
});

export default JoinRequestsScreen;
