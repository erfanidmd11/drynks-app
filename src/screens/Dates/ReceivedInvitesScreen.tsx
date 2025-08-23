// src/screens/Dates/ReceivedInvitesScreen.tsx
// Production ready:
// - AppShell wrapper (consistent header + footer)
// - Loads invites from date_requests where current user ∈ pending_users
// - Swipe right = Accept (moves to accepted_users), left = Dismiss (removes from pending_users)
// - Realtime: removes rows if date fills or pending status changes
// - Pull-to-refresh + focus refresh
// - Robust navigation to Explore & DateDetails
// - Witty empty state & hard guards around userId to prevent crashes

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Alert,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PanGestureHandler } from 'react-native-gesture-handler';
import Animated, {
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';

type UUID = string;

type ProfileLite = {
  id: UUID;
  screenname: string | null;
  profile_photo: string | null;
  gender?: string | null;
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

type InviteItem = {
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
const SWIPE_ACCEPT = 120;
const SWIPE_DECLINE = -120;

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(s || ''));

const ReceivedInvitesScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [userId, setUserId] = useState<UUID | null>(null);
  const [myGender, setMyGender] = useState<string | null>(null);
  const [rows, setRows] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------- helpers ----------
  const fetchSessionAndProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data?.session?.user?.id as UUID | undefined;
    if (!uid) {
      setUserId(null);
      setMyGender(null);
      return null;
    }
    setUserId(uid);

    // minimal viewer details (for gender decrement on accept)
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, gender')
      .eq('id', uid)
      .single();
    setMyGender(prof?.gender ?? null);

    return uid;
  }, []);

  const fetchProfiles = useCallback(async (ids: UUID[]): Promise<Record<string, ProfileLite>> => {
    if (!ids.length) return {};
    const { data, error } = await supabase
      .from('profiles')
      .select('id, screenname, profile_photo, gender, location')
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
    const map = await fetchProfiles(Array.from(new Set([...creatorIds, ...acceptedIds])));

    const items: InviteItem[] = dates.map(d => {
      const creator_profile = map[d.creator] || null;
      const accepted_profiles = (d.accepted_users || [])
        .map(uid => map[uid])
        .filter(Boolean);

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
      };
    });

    return items;
  }, [fetchProfiles]);

  const fetchInvites = useCallback(async (uid?: UUID | null) => {
    const current = typeof uid === 'string' ? uid : userId;
    if (!current) {
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!refreshing) setLoading(true);

    const { data, error } = await supabase
      .from('date_requests')
      .select(
        'id, title, location, event_date, event_type, who_pays, orientation_preference, profile_photo, photo_urls, creator, accepted_users, pending_users, spots, remaining_gender_counts, created_at'
      )
      .contains('pending_users', [current])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ReceivedInvites] load error', error);
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const hydrated = await hydrate((data || []) as DateRow[]);
    setRows(hydrated);
    setLoading(false);
    setRefreshing(false);
  }, [userId, hydrate, refreshing]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchInvites();
  }, [fetchInvites]);

  // Realtime: if date fills or pending changes, drop relevant invite
  const attachRealtime = useCallback((ids: string[], viewerId?: string | null) => {
    try { channelRef.current?.unsubscribe(); } catch {}
    channelRef.current = null;
    if (!ids.length) return;

    const ch = supabase.channel('received_invites_updates');
    ch.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'date_requests',
        filter: `id=in.(${ids.join(',')})`,
      },
      (payload: any) => {
        const d = payload?.new as DateRow | undefined;
        if (!d) return;

        const pending = Array.isArray(d.pending_users) ? d.pending_users : [];
        const viewer = viewerId || userId;
        const stillPending = viewer ? pending.includes(viewer) : false;

        const rgc = d.remaining_gender_counts || {};
        const remainingSum = Object.values(rgc).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        const isFull = Number.isFinite(remainingSum) && remainingSum === 0;

        if (!stillPending || isFull) {
          setRows(prev => prev.filter(r => r.date_id !== d.id));
        }
      }
    ).subscribe(() => {});

    channelRef.current = ch;
  }, [userId]);

  // -------- lifecycle --------
  useEffect(() => {
    (async () => {
      const uid = await fetchSessionAndProfile();
      await fetchInvites(uid);
    })();
    return () => { try { channelRef.current?.unsubscribe(); } catch {} };
  }, [fetchSessionAndProfile, fetchInvites]);

  useEffect(() => {
    const ids = rows.map(r => r.date_id);
    attachRealtime(ids, userId);
  }, [rows, attachRealtime, userId]);

  // Also refresh on focus (keeps list fresh after actions elsewhere)
  useFocusEffect(
    useCallback(() => {
      fetchInvites();
    }, [fetchInvites])
  );

  // ---------- actions ----------
  const acceptInvite = useCallback(async (row: InviteItem) => {
    if (!userId) return;
    try {
      // Load current arrays
      const { data: d, error } = await supabase
        .from('date_requests')
        .select('pending_users, accepted_users, remaining_gender_counts, title')
        .eq('id', row.date_id)
        .single();
      if (error || !d) throw error || new Error('Date not found');

      const pending: UUID[] = Array.isArray(d.pending_users) ? d.pending_users : [];
      const accepted: UUID[] = Array.isArray(d.accepted_users) ? d.accepted_users : [];

      const nextPending = pending.filter(id => id !== userId);
      const nextAccepted = accepted.includes(userId) ? accepted : [...accepted, userId];

      const rgc = (d.remaining_gender_counts || {}) as Record<string, number>;
      if (myGender && typeof rgc[myGender] === 'number' && rgc[myGender] > 0) {
        rgc[myGender] = rgc[myGender] - 1;
      }

      const { error: uErr } = await supabase
        .from('date_requests')
        .update({
          pending_users: nextPending,
          accepted_users: nextAccepted,
          remaining_gender_counts: rgc,
        })
        .eq('id', row.date_id);
      if (uErr) throw uErr;

      // Optimistic remove
      setRows(prev => prev.filter(r => r.date_id !== row.date_id));

      Alert.alert('Accepted 🎉', 'You’ll find this under My Dates > Accepted.');
    } catch (e: any) {
      console.error('[ReceivedInvites] accept error', e);
      Alert.alert('Error', e?.message || 'Could not accept this invite right now.');
    }
  }, [userId, myGender]);

  const declineInvite = useCallback(async (row: InviteItem) => {
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

      setRows(prev => prev.filter(r => r.date_id !== row.date_id));
    } catch (e: any) {
      console.error('[ReceivedInvites] decline error', e);
      Alert.alert('Error', e?.message || 'Could not dismiss this invite right now.');
    }
  }, [userId]);

  // ---------- UI ----------
  const goExplore = () => {
    // robust nav to your Explore/Home feed
    try { navigation.navigate('Explore'); return; } catch {}
    try { navigation.navigate('Home'); return; } catch {}
    try { navigation.navigate('DateFeed'); return; } catch {}
    navigation.goBack();
  };

  const isPast = (d?: string | null) => (d ? new Date(d) < new Date() : false);
  const remainingSpots = (row: InviteItem) => {
    const rgc = row.remaining_gender_counts || {};
    const sum = Object.values(rgc).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    return Number.isFinite(sum) ? (sum as number) : undefined;
  };

  const renderRow = ({ item, index }: { item: InviteItem; index: number }) => {
    const tx = useSharedValue(0);
    const opacity = useSharedValue(1);

    const onFinish = (cb: () => void) => {
      opacity.value = withTiming(0, { duration: 180 }, () => runOnJS(cb)());
    };

    const gesture = useAnimatedGestureHandler({
      onActive: (e) => { tx.value = e.translationX; },
      onEnd: (e) => {
        if (e.translationX > SWIPE_ACCEPT) {
          tx.value = withSpring(SCREEN_W, {}, () =>
            runOnJS(onFinish)(() => runOnJS(acceptInvite)(item))
          );
        } else if (e.translationX < SWIPE_DECLINE) {
          tx.value = withSpring(-SCREEN_W, {}, () =>
            runOnJS(onFinish)(() => runOnJS(declineInvite)(item))
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

    const bgStyle = useAnimatedStyle(() => {
      const bg =
        tx.value > 0
          ? 'rgba(46, 204, 113, 0.15)'
          : tx.value < 0
          ? 'rgba(231, 76, 60, 0.15)'
          : 'transparent';
      return { backgroundColor: bg };
    });

    const remaining = remainingSpots(item);
    const disabled = isPast(item.event_date) || (typeof remaining === 'number' && remaining <= 0);

    return (
      <PanGestureHandler onGestureEvent={gesture}>
        <Animated.View
          entering={FadeInUp.delay(index * 50).duration(300)}
          style={[styles.rowWrap, bgStyle]}
        >
          {/* inline hints */}
          <View style={styles.hintsRow}>
            <Text style={styles.hintLeft}>← Dismiss</Text>
            <Text style={styles.hintRight}>Accept →</Text>
          </View>

          <Animated.View style={[cardStyle]}>
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
              userId={userId!} // safe due to guards below
              isCreator={false}
              isAccepted={false}
              disabled={disabled}
              onPressCard={() => {
                try { navigation.navigate('DateDetails', { dateId: item.date_id }); } catch {}
              }}
              onAccept={() => acceptInvite(item)}
              onChat={() => {}}
            />
          </Animated.View>
        </Animated.View>
      </PanGestureHandler>
    );
  };

  // ---------- guards & branches (keep AppShell always) ----------
  if (loading) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: '#666' }}>Loading your invites…</Text>
        </View>
      </AppShell>
    );
  }

  if (!userId) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            You’re off the grid—sign in to see who’s inviting you out. 🍸
          </Text>
          <TouchableOpacity onPress={() => { try { navigation.navigate('Login'); } catch {} }} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </AppShell>
    );
  }

  if (!rows.length) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No pending invites… yet. Your inbox is thirstier than a dry martini. 🍸
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
      {/* Inline hint banner */}
      <View style={styles.instructions}>
        <Text style={styles.instructionsText}>
          Swipe <Text style={{ fontWeight: '800' }}>right</Text> to accept • Swipe{' '}
          <Text style={{ fontWeight: '800' }}>left</Text> to dismiss
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(it) => it.date_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={renderRow}
      />
    </AppShell>
  );
};

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 12 },
  primaryBtn: { backgroundColor: DRYNKS_RED, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  instructions: { paddingHorizontal: 16, paddingBottom: 6 },
  instructionsText: { textAlign: 'center', color: '#444' },
  rowWrap: { marginBottom: 16, borderRadius: 20 },
  hintsRow: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    zIndex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hintLeft: { color: 'rgba(231,76,60,0.9)', fontWeight: '700' },
  hintRight: { color: 'rgba(46,204,113,0.9)', fontWeight: '700' },
});

export default ReceivedInvitesScreen;
