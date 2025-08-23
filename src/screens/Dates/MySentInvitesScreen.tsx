// src/screens/Dates/MySentInvitesScreen.tsx
// Production-ready:
// - AppShell (global header + footer)
// - Loads pending sent invites via RPC `host_sent_invites()` (uses auth.uid())
// - Right-swipe to rescind (removes recipient from date_requests.pending_users + bell/push)
// - Realtime: rows auto-remove when invitee accepts/declines (pending_users change)
// - Pull-to-refresh + focus refresh
// - Safe guards for null user, noisy locations, and navigation

import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  runOnJS,
} from 'react-native-reanimated';

import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';
import { notifyInviteRevoked } from '@services/NotificationService';

type UUID = string;

type SentInviteRow = {
  id: string;            // synthetic id per (date_id, recipient_id) – enforced below if RPC doesn't provide it
  date_id: UUID;
  recipient_id: UUID;
  created_at: string;
  // Embedded date payload ready for DateCard (creator_profile, accepted_profiles, etc.)
  date: any;
};

const DRYNKS_RED = '#E34E5C';
const SCREEN_W = Dimensions.get('window').width;

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const MySentInvitesScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<SentInviteRow[]>([]);
  const [me, setMe] = useState<UUID | null>(null);

  // Realtime channel
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------- Load session + rows ----------
  const fetchRows = useCallback(async () => {
    try {
      const { data: s } = await supabase.auth.getSession();
      const uid = s?.session?.user?.id as UUID | undefined;
      setMe(uid ?? null);

      if (!uid) {
        setRows([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setLoading(true);
      // Uses auth.uid() inside the RPC; no param required.
      const { data, error } = await supabase.rpc('host_sent_invites');

      if (error) {
        console.error('[SentInvites] fetch error', error);
        setRows([]);
      } else {
        const arr = Array.isArray(data) ? (data as any[]) : [];

        // Normalize each row:
        // - ensure a stable "id"
        // - sanitize noisy location on embedded date payload (if present)
        const cleaned: SentInviteRow[] = arr.map((raw) => {
          const composedId =
            typeof raw.id === 'string' && raw.id.length
              ? raw.id
              : `${raw.date_id}:${raw.recipient_id}`;

          const d = raw.date || {};
          const loc = d?.location;
          const safeDate = looksLikeWKTOrHex(loc)
            ? { ...d, location: d?.creator_profile?.location ?? null }
            : d;

          return {
            id: composedId,
            date_id: raw.date_id,
            recipient_id: raw.recipient_id,
            created_at: raw.created_at,
            date: safeDate,
          } as SentInviteRow;
        });

        setRows(cleaned);
      }
    } catch (e) {
      console.error('[SentInvites] fetch error', e);
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRows();
  }, [fetchRows]);

  // First-run hint (swipe)
  const showSwipeHintOnce = useCallback(async () => {
    try {
      const seen = await AsyncStorage.getItem('hint_my_sent_invites');
      if (!seen) {
        Alert.alert(
          'Tip',
          'Swipe right on a row to rescind the invite.',
          [{ text: 'Got it', onPress: () => AsyncStorage.setItem('hint_my_sent_invites', 'true') }]
        );
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchRows();
    showSwipeHintOnce();
  }, [fetchRows, showSwipeHintOnce]);

  // Also refresh whenever the screen gets focus
  useFocusEffect(
    useCallback(() => {
      fetchRows();
    }, [fetchRows])
  );

  // ---------- Realtime: watch current dates; drop rows when no longer pending ----------
  const attachRealtime = useCallback((dateIds: string[]) => {
    try { channelRef.current?.unsubscribe(); } catch {}
    channelRef.current = null;

    if (!dateIds.length) return;

    const channel = supabase
      .channel('sent_invites_dates_updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'date_requests',
          filter: `id=in.(${dateIds.join(',')})`,
        },
        (payload: any) => {
          const d = payload?.new;
          if (!d) return;
          const pending: string[] = Array.isArray(d.pending_users) ? d.pending_users : [];
          setRows(prev =>
            prev.filter(r => (r.date_id !== d.id) || pending.includes(r.recipient_id))
          );
        }
      )
      .subscribe();

    channelRef.current = channel;
  }, []);

  // Re-attach realtime whenever the set of date_ids changes
  useEffect(() => {
    const ids = Array.from(new Set(rows.map(r => r.date_id)));
    attachRealtime(ids);
    return () => { try { channelRef.current?.unsubscribe(); } catch {} };
  }, [rows, attachRealtime]);

  // ---------- Navigation helpers ----------
  const openDateDetails = (dateId: string) => {
    try { navigation.navigate('DateDetails', { dateId }); return; } catch {}
    try { navigation.navigate('MyDates', { focusId: dateId }); return; } catch {}
    try { navigation.navigate('DateFeed', { scrollToDateId: dateId }); return; } catch {}
  };

  const openProfile = (userId: string) => {
    try { navigation.navigate('Profile', { userId, origin: 'MySentInvites' }); return; } catch {}
    try { navigation.navigate('PublicProfile', { userId, origin: 'MySentInvites' }); return; } catch {}
  };

  // ---------- Actions ----------
  const rescindInvite = async (row: SentInviteRow) => {
    try {
      // 1) Remove recipient from date.pending_users
      const { data: dateRow, error: dErr } = await supabase
        .from('date_requests')
        .select('pending_users, title')
        .eq('id', row.date_id)
        .single();

      if (dErr || !dateRow) throw dErr || new Error('Date not found');

      const pending: string[] = Array.isArray(dateRow.pending_users) ? dateRow.pending_users : [];
      const nextPending = pending.filter((id) => id !== row.recipient_id);

      const { error: uErr } = await supabase
        .from('date_requests')
        .update({ pending_users: nextPending })
        .eq('id', row.date_id);
      if (uErr) throw uErr;

      // 2) Notify recipient
      await notifyInviteRevoked({
        recipientId: row.recipient_id,
        dateId: row.date_id,
        eventTitle: dateRow?.title || 'your date',
      });

      // 3) Optimistic local remove
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (e: any) {
      console.error('[SentInvites] rescind error', e);
      Alert.alert('Could not rescind invite', e?.message || 'Try again later.');
    }
  };

  // ---------- Guards that prevent crashes ----------
  // If we don't have a logged-in user, don't render DateCards (they require userId).
  if (loading) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            You’re signed out—sent invites live here once you’re back in. 🍹
          </Text>
          <TouchableOpacity
            onPress={() => { try { navigation.navigate('Login'); } catch {} }}
            style={styles.ctaBtn}
          >
            <Text style={styles.ctaBtnText}>Sign In</Text>
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
            No sent invites… yet. Be the hero your night deserves—send one now. 🥂
          </Text>
          <TouchableOpacity
            onPress={() => {
              try { navigation.navigate('InviteNearby'); return; } catch {}
              try { navigation.navigate('CreateDate'); return; } catch {}
            }}
            style={styles.ctaBtn}
          >
            <Text style={styles.ctaBtnText}>Invite Nearby</Text>
          </TouchableOpacity>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell currentTab="My DrYnks">
      {/* Inline hint */}
      <View style={styles.instructions}>
        <Text style={styles.instructionsText}>
          Swipe <Text style={{ fontWeight: '800' }}>right</Text> to rescind an invite
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item, index }) => {
          const translateX = useSharedValue(0);

          const gestureHandler = useAnimatedGestureHandler({
            onActive: (e) => { translateX.value = e.translationX; },
            onEnd: (e) => {
              if (e.translationX > 100) {
                translateX.value = withSpring(SCREEN_W, {}, () =>
                  runOnJS(rescindInvite)(item)
                );
              } else {
                translateX.value = withSpring(0);
              }
            },
          });

          const animatedStyle = useAnimatedStyle(() => ({
            transform: [{ translateX: translateX.value }],
          }));

          return (
            <PanGestureHandler onGestureEvent={gestureHandler}>
              <Animated.View
                entering={FadeInUp.delay(index * 50).duration(300)}
                style={[animatedStyle, { marginBottom: 16 }]}
              >
                <DateCard
                  date={item.date}
                  userId={me}            // GUARANTEED non-null due to guard above
                  isCreator
                  disabled={false}
                  onPressCard={() => openDateDetails(item.date_id)}
                  onPressProfile={(pid: string) => openProfile(pid)}
                />
              </Animated.View>
            </PanGestureHandler>
          );
        }}
      />
    </AppShell>
  );
};

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 12 },
  instructions: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  instructionsText: { textAlign: 'center', color: '#444' },
  ctaBtn: {
    marginTop: 10,
    backgroundColor: DRYNKS_RED,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  ctaBtnText: { color: '#fff', fontWeight: '700' },
});

export default MySentInvitesScreen;
