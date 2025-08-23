// src/screens/Dates/ManageApplicantsScreen.tsx
// Production-ready:
// - AppShell header/footer
// - Single-date or all hosted dates (when no dateId provided)
// - Section headers: show which date (title • date • city • spots left if known)
// - Accept/Decline via respond_to_date RPC (+ optional chat group add/remove)
// - Realtime: auto-refresh when pending/accepted/remaining counts change
// - Hides applicants if date is full or in the past
// - Witty empty states

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import ProfileCard from '@components/cards/ProfileCard';

type UUID = string;
type RouteParams = { dateId?: string };

type ProfileLite = {
  id: UUID;
  screenname?: string | null;
  profile_photo?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  location?: string | null;
  preferences?: string[] | null;
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
  pending_users: UUID[] | null;
  accepted_users: UUID[] | null;
  spots: number | null;
  remaining_gender_counts: Record<string, number> | null;
  created_at: string | null;
};

type ApplicantRow = {
  row_id: string; // `${date_id}:${applicant.id}` (stable key)
  date_id: UUID;
  date_title: string | null;
  date_event_date: string | null;
  date_location: string | null;
  remaining_gender_counts: Record<string, number> | null;
  applicant: ProfileLite;
};

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const ManageApplicantsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { dateId } = (route?.params as RouteParams) || {};

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ApplicantRow[]>([]);
  const [me, setMe] = useState<UUID | null>(null);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------- utilities ----------
  const isPast = (iso?: string | null) => (iso ? new Date(iso) < new Date() : false);
  const spotsLeft = (rgc?: Record<string, number> | null) => {
    const sum = Object.values(rgc || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    return Number.isFinite(sum) ? (sum as number) : undefined;
  };

  const showHintOnce = useCallback(async () => {
    try {
      const seen = await AsyncStorage.getItem('hint_manage_applicants_v2');
      if (!seen) {
        Alert.alert(
          'Tip',
          'Tap “Invite” to accept an applicant. Tap “Decline this request” to reject.',
          [{ text: 'Got it', onPress: () => AsyncStorage.setItem('hint_manage_applicants_v2', 'true') }]
        );
      }
    } catch {}
  }, []);

  const markJoinRequestsRead = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id;
      if (!uid) return;
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', uid)
        .in('type', ['join_request_received']);
    } catch (e) {
      console.warn('[ManageApplicants] mark read failed:', (e as Error).message);
    }
  }, []);

  // ---------- data fetch ----------
  const fetchProfiles = useCallback(async (ids: UUID[]) => {
    if (!ids.length) return {} as Record<string, ProfileLite>;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, screenname, profile_photo, birthdate, gender, location, preferences')
      .in('id', ids);
    if (error || !data) return {};
    return data.reduce((acc: Record<string, ProfileLite>, p: any) => {
      acc[p.id] = p;
      return acc;
    }, {});
  }, []);

  const fetchHostedDates = useCallback(async (hostId: UUID, onlyId?: UUID) => {
    let query = supabase
      .from('date_requests')
      .select(
        'id, title, location, event_date, event_type, who_pays, orientation_preference, profile_photo, photo_urls, creator, pending_users, accepted_users, spots, remaining_gender_counts, created_at'
      )
      .eq('creator', hostId)
      .order('created_at', { ascending: false });

    if (onlyId) query = query.eq('id', onlyId);

    const { data, error } = await query;
    if (error || !data) return [] as DateRow[];
    return data as DateRow[];
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id as UUID | undefined;
      setMe(uid ?? null);
      if (!uid) {
        setRows([]);
        setLoading(false);
        return;
      }

      const dates = await fetchHostedDates(uid, dateId);
      // keep dates that (1) have pending users, (2) are not past, (3) not full
      const keep = dates.filter(d => {
        const pending = Array.isArray(d.pending_users) && d.pending_users.length > 0;
        const future = !isPast(d.event_date);
        const remaining = spotsLeft(d.remaining_gender_counts);
        const available = typeof remaining === 'number' ? remaining > 0 : true;
        return pending && future && available;
      });
      if (!keep.length) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Collect all pending user ids across kept dates
      const allPendingIds = Array.from(
        new Set(
          keep.flatMap(d => (Array.isArray(d.pending_users) ? d.pending_users : []))
        )
      ) as UUID[];

      const profMap = await fetchProfiles(allPendingIds);

      // Build rows
      const out: ApplicantRow[] = [];
      for (const d of keep) {
        const city = looksLikeWKTOrHex(d.location)
          ? undefined
          : d.location || undefined;
        for (const uid2 of (d.pending_users || [])) {
          const applicant = profMap[uid2];
          if (!applicant) continue;
          out.push({
            row_id: `${d.id}:${uid2}`,
            date_id: d.id,
            date_title: d.title,
            date_event_date: d.event_date,
            date_location: city ?? null,
            remaining_gender_counts: d.remaining_gender_counts || null,
            applicant,
          });
        }
      }

      // Sort by date (most recent first), then by applicant name
      out.sort((a, b) => {
        const ta = +(new Date(a.date_event_date || 0));
        const tb = +(new Date(b.date_event_date || 0));
        if (tb !== ta) return tb - ta;
        const an = (a.applicant.screenname || '').toLowerCase();
        const bn = (b.applicant.screenname || '').toLowerCase();
        return an.localeCompare(bn);
      });

      setRows(out);
    } catch (e) {
      console.error('[ManageApplicants] load error', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dateId, fetchHostedDates, fetchProfiles]);

  // Realtime: watch visible dates; on any update, refresh the list
  const attachRealtime = useCallback((ids: string[]) => {
    try { channelRef.current?.unsubscribe(); } catch {}
    channelRef.current = null;
    if (!ids.length) return;

    const channel = supabase.channel('manage_applicants_dates');
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'date_requests', filter: `id=in.(${ids.join(',')})` },
      () => { load(); }
    ).subscribe(() => {});
    channelRef.current = channel;
  }, [load]);

  useEffect(() => {
    load();
    showHintOnce();
    markJoinRequestsRead();
    return () => { try { channelRef.current?.unsubscribe(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    const ids = Array.from(new Set(rows.map(r => r.date_id)));
    attachRealtime(ids);
  }, [rows, attachRealtime]);

  // ---------- actions ----------
  const respond = useCallback(async (date_id: string, user_id: string, accept: boolean) => {
    const successMsg = accept
      ? 'You just made someone’s day 💌'
      : 'Request declined.';
    try {
      const { error } = await supabase.rpc('respond_to_date', {
        date_id_input: date_id,
        user_id_input: user_id,
        accept,
      });
      if (error) throw error;

      // Optional chat management (best-effort) — wrap each RPC in try/catch
      if (accept) {
        try {
          await supabase.rpc('add_user_to_chat_group', { date_id_input: date_id, user_id_input: user_id });
        } catch {}
      } else {
        try {
          await supabase.rpc('remove_user_from_chat_group', { date_id_input: date_id, user_id_input: user_id });
        } catch {}
      }

      Alert.alert('Response Sent', successMsg);
      // Optimistic remove; realtime will also refresh
      setRows(prev => prev.filter(r => !(r.date_id === date_id && r.applicant.id === user_id)));
    } catch (err: any) {
      console.error('[ManageApplicants] respond error', err);
      Alert.alert('Error', err?.message || 'Could not respond to user.');
    }
  }, []);

  // ---------- UI helpers ----------
  const firstIndexByDate = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, idx) => {
      if (!map.has(r.date_id)) map.set(r.date_id, idx);
    });
    return map;
  }, [rows]);

  const SectionHeader = ({ item }: { item: ApplicantRow }) => {
    const left = spotsLeft(item.remaining_gender_counts);
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {item.date_title || 'Untitled'}{item.date_location ? ` • ${item.date_location}` : ''}
        </Text>
        <Text style={styles.sectionSub}>
          {item.date_event_date ? new Date(item.date_event_date).toDateString() : ''}
          {typeof left === 'number' ? ` • ${left} spot${left === 1 ? '' : 's'} left` : ''}
        </Text>
      </View>
    );
  };

  // ---------- render ----------
  if (loading) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={DRYNKS_RED} />
        </View>
      </AppShell>
    );
  }

  if (!rows.length) {
    return (
      <AppShell currentTab="My DrYnks">
        <Animated.View entering={FadeInUp} style={styles.center}>
          <Text style={{ color: '#666', textAlign: 'center', marginBottom: 12 }}>
            No applicants right now — they’ll appear here as they come in.
          </Text>
          <TouchableOpacity
            onPress={() => { try { navigation.navigate('CreateDate'); } catch {} }}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryBtnText}>+ Create Date</Text>
          </TouchableOpacity>
        </Animated.View>
      </AppShell>
    );
  }

  return (
    <AppShell currentTab="My DrYnks">
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
        <Text style={{ textAlign: 'center', color: '#666' }}>
          Tap <Text style={{ fontWeight: '800' }}>Invite</Text> to accept • Tap{' '}
          <Text style={{ fontWeight: '800' }}>Decline this request</Text> to reject
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(it) => it.row_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(index * 60)}>
            {/* Section header when the date changes */}
            {firstIndexByDate.get(item.date_id) === index ? <SectionHeader item={item} /> : null}

            <ProfileCard
              user={item.applicant}
              origin="ManageApplicants"
              onPressProfile={() =>
                navigation.navigate('PublicProfile', { userId: item.applicant.id, origin: 'ManageApplicants' })
              }
              onNamePress={() =>
                navigation.navigate('PublicProfile', { userId: item.applicant.id, origin: 'ManageApplicants' })
              }
              onInvite={() => respond(item.date_id, item.applicant.id, true)}
            />
            <Text
              style={styles.decline}
              onPress={() => respond(item.date_id, item.applicant.id, false)}
            >
              ❌ Decline this request
            </Text>
          </Animated.View>
        )}
      />
    </AppShell>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sectionHeader: { marginBottom: 8, paddingHorizontal: 6 },
  sectionTitle: { color: DRYNKS_BLUE, fontWeight: '800', fontSize: 16 },
  sectionSub: { color: '#66707A', fontSize: 12, marginTop: 2 },
  decline: { textAlign: 'center', color: '#999', fontSize: 14, marginBottom: 20, marginTop: 10 },
  primaryBtn: { backgroundColor: DRYNKS_RED, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});

export default ManageApplicantsScreen;
