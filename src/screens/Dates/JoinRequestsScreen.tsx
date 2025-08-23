// src/screens/Dates/JoinRequestsScreen.tsx
// Production-ready "My Join Requests":
// - AppShell wrapper (consistent header + footer)
// - Lists dates where the current user is in date_requests.pending_users
// - Swipe left to cancel your request (removes your id from pending_users)
// - Realtime: removes rows when host accepts/declines you or date fills
// - Pull-to-refresh + focus refresh
// - Robust navigation to Explore / DateDetails
// - Witty empty / signed-out states and guards around userId

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { PanGestureHandler } from 'react-native-gesture-handler';
import Animated, {
  FadeInUp,
  runOnJS,
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';

type UUID = string;

type ProfileLite = {
  id: UUID;
  screenname: string | null;
  profile_photo: string | null;
  location?: string | null;
};

type DateRow = {
  id: UUID;
  title: string | null;
  location: string | null;
  event_date: string | null;
  event_type: string | null;
  who_pays: string | null;
  orientation_preference: string[] | null;
  profile_photo: string | null;
  photo_urls: string[] | null;
  creator: UUID;
  accepted_users: UUID[] | null;
  pending_users: UUID[] | null;
  spots: number | null;
  remaining_gender_counts: Record<string, number> | null;
  created_at?: string | null;
};

type Item = {
  date_id: UUID;
  title: string | null;
  event_date: string | null;
  location: string | null;
  who_pays: string | null;
  event_type: string | null;
  orientation_preference: string[] | null;
  profile_photo: string | null;
  photo_urls: string[] | null;
  creator_id: UUID;
  creator_profile: ProfileLite | null;
  accepted_profiles: ProfileLite[];
  spots: number | null;
  remaining_gender_counts: Record<string, number> | null;
  created_at?: string | null;
};

const DRYNKS_RED = '#E34E5C';
const SCREEN_W = Dimensions.get('window').width;
const SWIPE_CANCEL = -120;

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const JoinRequestsScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [userId, setUserId] = useState<UUID | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------- bootstrap ----------
  const fetchSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data?.session?.user?.id as UUID | undefined;
    setUserId(uid ?? null);
    return uid ?? null;
  }, []);

  const fetchProfiles = useCallback(async (ids: UUID[]): Promise<Record<string, ProfileLite>> => {
    if (!ids.length) return {};
    const { data, error } = await supabase
      .from('profiles')
      .select('id, screenname, profile_photo, location')
      .in('id', ids);
    if (error || !data) return {};
    return data.reduce((acc: Record<string, ProfileLite>, p: any) => {
      acc[p.id] = p;
      return acc;
    }, {});
  }, []);

  const hydrate = useCallback(async (dates: DateRow[]) => {
    const creatorIds = Array.from(new Set(dates.map(d => d.creator)));
    const acceptedIds = Array.from(
      new Set(dates.flatMap(d => (Array.isArray(d.accepted_users) ? d.accepted_users : [])))
    );
    const profileMap = await fetchProfiles(Array.from(new Set([...creatorIds, ...acceptedIds])));

    return dates.map(d => {
      const creator_profile = profileMap[d.creator] || null;
      const accepted_profiles = (d.accepted_users || []).map(uid => profileMap[uid]).filter(Boolean);

      // sanitize noisy location (WKT/hex) to a readable creator location if needed
      const cleanLoc = looksLikeWKTOrHex(d.location) ? (creator_profile?.location ?? null) : d.location;

      return {
        date_id: d.id,
        title: d.title,
        event_date: d.event_date,
        location: cleanLoc,
        who_pays: d.who_pays,
        event_type: d.event_type,
        orientation_preference: d.orientation_preference || [],
        profile_photo: d.profile_photo || null,
        photo_urls: d.photo_urls || [],
        creator_id: d.creator,
        creator_profile,
        accepted_profiles,
        spots: d.spots,
        remaining_gender_counts: d.remaining_gender_counts || null,
        created_at: d.created_at,
      } as Item;
    });
  }, [fetchProfiles]);

  const load = useCallback(async (uid?: UUID | null) => {
    const current = typeof uid === 'string' ? uid : userId;
    if (!current) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!refreshing) setLoading(true);
    try {
      // All dates where I have a pending join request
      const { data, error } = await supabase
        .from('date_requests')
        .select(
          'id, title, location, event_date, event_type, who_pays, orientation_preference, profile_photo, photo_urls, creator, accepted_users, pending_users, spots, remaining_gender_counts, created_at'
        )
        .contains('pending_users', [current])
        .order('created_at', { ascending: false });

      if (error) throw error;

      const hydrated = await hydrate((data || []) as DateRow[]);
      setItems(hydrated);
    } catch (e) {
      console.error('[JoinRequests] load error', e);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, hydrate, refreshing]);

  useEffect(() => {
    (async () => {
      const uid = await fetchSession();
      await load(uid);
    })();
    return () => {
      try { channelRef.current?.unsubscribe(); } catch {}
    };
  }, [fetchSession, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Realtime: if pending status changes (accepted/declined) or date fills, remove the row
  const attachRealtime = useCallback((ids: string[], viewerId?: string | null) => {
    try { channelRef.current?.unsubscribe(); } catch {}
    channelRef.current = null;
    if (!ids.length) return;

    const ch = supabase.channel('my_join_requests_updates');
    ch.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'date_requests', filter: `id=in.(${ids.join(',')})` },
      (payload: any) => {
        const d = payload?.new as DateRow | undefined;
        if (!d) return;
        const viewer = viewerId || userId;
        const pending = Array.isArray(d.pending_users) ? d.pending_users : [];
        const stillPending = viewer ? pending.includes(viewer) : false;

        const rgc = d.remaining_gender_counts || {};
        const sum = Object.values(rgc).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        const full = Number.isFinite(sum) && sum === 0;

        if (!stillPending || full) {
          setItems(prev => prev.filter(it => it.date_id !== d.id));
        }
      }
    ).subscribe(() => {});
    channelRef.current = ch;
  }, [userId]);

  useEffect(() => {
    attachRealtime(items.map(i => i.date_id), userId);
  }, [items, attachRealtime, userId]);

  // ---------- actions ----------
  const cancelRequest = useCallback(async (row: Item) => {
    if (!userId) return;
    try {
      const { data: d, error } = await supabase
        .from('date_requests')
        .select('pending_users, title')
        .eq('id', row.date_id)
        .single();
      if (error || !d) throw error || new Error('Date not found');

      const pending: UUID[] = Array.isArray(d.pending_users) ? d.pending_users : [];
      const nextPending = pending.filter(id => id !== userId);

      const { error: uErr } = await supabase
        .from('date_requests')
        .update({ pending_users: nextPending })
        .eq('id', row.date_id);
      if (uErr) throw uErr;

      setItems(prev => prev.filter(it => it.date_id !== row.date_id));
    } catch (e: any) {
      console.error('[JoinRequests] cancel error', e);
      Alert.alert('Error', e?.message || 'Could not cancel your request.');
    }
  }, [userId]);

  // ---------- UI helpers ----------
  const goExplore = () => {
    try { navigation.navigate('Explore'); return; } catch {}
    try { navigation.navigate('Home'); return; } catch {}
    try { navigation.navigate('DateFeed'); return; } catch {}
    navigation.goBack();
  };

  const remainingSpots = (row: Item) => {
    const rgc = row.remaining_gender_counts || {};
    const sum = Object.values(rgc).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    return Number.isFinite(sum) ? (sum as number) : undefined;
  };
  const isPast = (d?: string | null) => (d ? new Date(d) < new Date() : false);

  const renderRow = ({ item, index }: { item: Item; index: number }) => {
    const tx = useSharedValue(0);
    const opacity = useSharedValue(1);

    const onFinish = (cb: () => void) => {
      opacity.value = withTiming(0, { duration: 180 }, () => runOnJS(cb)());
    };

    const gesture = useAnimatedGestureHandler({
      onActive: (e) => { tx.value = e.translationX; },
      onEnd: (e) => {
        if (e.translationX < SWIPE_CANCEL) {
          tx.value = withSpring(-SCREEN_W, {}, () =>
            runOnJS(onFinish)(() => runOnJS(cancelRequest)(item))
          );
        } else {
          tx.value = withSpring(0);
        }
      },
    });

    const cardStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: tx.value }],
      opacity: opacity.value,
    }));

    const bgStyle = useAnimatedStyle(() => ({
      backgroundColor: tx.value < 0 ? 'rgba(231,76,60,0.12)' : 'transparent',
    }));

    const remaining = remainingSpots(item);
    const disabled = isPast(item.event_date) || (typeof remaining === 'number' && remaining <= 0);

    return (
      <PanGestureHandler onGestureEvent={gesture}>
        <Animated.View
          entering={FadeInUp.delay(index * 50).duration(300)}
          style={[styles.rowWrap, bgStyle]}
        >
          {/* inline hint (matches left-swipe) */}
          <View style={styles.hintsRow}>
            <Text style={styles.hintText}>← Cancel request</Text>
          </View>

          <Animated.View style={[cardStyle]}>
            <View style={{ marginBottom: 6, alignItems: 'flex-start' }}>
              <Text style={styles.pendingPill}>Pending</Text>
            </View>
            <DateCard
              date={{
                id: item.date_id,
                title: item.title,
                event_date: item.event_date,
                location: item.location,
                creator_id: item.creator_id,
                creator_profile: item.creator_profile,
                accepted_profiles: item.accepted_profiles,
                who_pays: item.who_pays,
                event_type: item.event_type,
                orientation_preference: item.orientation_preference || ['Everyone'],
                remaining_gender_counts: item.remaining_gender_counts || undefined,
                created_at: item.created_at || undefined,
                profile_photo: item.profile_photo || undefined,
                photo_urls: item.photo_urls || [],
              }}
              userId={userId!}          // guarded by branches below
              isCreator={false}
              isAccepted={false}
              disabled={disabled}
              onPressCard={() => {
                try { navigation.navigate('DateDetails', { dateId: item.date_id }); } catch {}
              }}
            />
          </Animated.View>
        </Animated.View>
      </PanGestureHandler>
    );
  };

  // ---------- guarded branches (AppShell always present) ----------
  if (loading) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: '#666' }}>Loading your join requests…</Text>
        </View>
      </AppShell>
    );
  }

  if (!userId) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            You’re incognito—sign in to see your join requests. 🕵️‍♀️
          </Text>
          <TouchableOpacity onPress={() => { try { navigation.navigate('Login'); } catch {} }} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </AppShell>
    );
  }

  if (!items.length) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No join requests on the board. Your social calendar is chilling on ice. 🧊
          </Text>
          <TouchableOpacity onPress={goExplore} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Find Dates</Text>
          </TouchableOpacity>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell currentTab="My DrYnks">
      {/* hint */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 }}>
        <Text style={{ textAlign: 'center', color: '#666' }}>
          Swipe <Text style={{ fontWeight: '800' }}>left</Text> to cancel your request
        </Text>
      </View>

      <FlatList
        data={useMemo(() => items, [items])}
        keyExtractor={(x) => x.date_id}
        renderItem={renderRow}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              try { await load(); } finally { setRefreshing(false); }
            }}
          />
        }
      />
    </AppShell>
  );
};

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#555', fontSize: 16, textAlign: 'center', marginBottom: 12 },
  primaryBtn: { backgroundColor: DRYNKS_RED, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },

  rowWrap: { marginBottom: 16, borderRadius: 20 },
  hintsRow: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    zIndex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  hintText: { color: 'rgba(231,76,60,0.9)', fontWeight: '700' },

  pendingPill: {
    backgroundColor: '#E7EBF0',
    color: '#23303A',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
});

export default JoinRequestsScreen;
