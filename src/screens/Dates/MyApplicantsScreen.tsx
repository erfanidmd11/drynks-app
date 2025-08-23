// src/screens/Dates/MyApplicantsScreen.tsx
// Production-ready:
// - AppShell header/footer
// - Uses RPC get_applicants_for_host(host_id) when present; falls back to assembling from date_requests
// - Section headers (which date: title • date • city • spots left)
// - Accept / Decline with optimistic update + remaining_gender_counts decrement
// - Realtime refresh on date_requests updates
// - Hides applicants if date is full or past
// - Witty empty state

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { PanGestureHandler } from 'react-native-gesture-handler';
import Animated, {
  FadeInUp,
  runOnJS,
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import ProfileCard from '@components/cards/ProfileCard';

type UUID = string;

type ProfileLite = {
  id: UUID;
  screenname?: string | null;
  profile_photo?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  orientation?: string | null;
  preferences?: string[] | null;
  location?: string | null;
  distance_km?: number | null;
};

type DateRow = {
  id: UUID;
  title: string | null;
  location: string | null;
  event_date: string | null;
  pending_users: UUID[] | null;
  accepted_users?: UUID[] | null;
  remaining_gender_counts: Record<string, number> | null;
  created_at: string | null;
};

type ApplicantRow = {
  row_id: string; // `${date_id}:${applicant.id}`
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

const MyApplicantsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [rows, setRows] = useState<ApplicantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<UUID | null>(null);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ------------ helpers ------------
  const isPast = (iso?: string | null) => (iso ? new Date(iso) < new Date() : false);
  const spotsLeft = (rgc?: Record<string, number> | null) => {
    const sum = Object.values(rgc || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    return Number.isFinite(sum) ? (sum as number) : undefined;
  };

  // ------------ data fetch ------------
  const fetchProfiles = useCallback(async (ids: UUID[]) => {
    if (!ids.length) return {} as Record<string, ProfileLite>;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, screenname, profile_photo, birthdate, gender, orientation, preferences, location')
      .in('id', ids);
    if (error || !data) return {};
    return data.reduce((acc: Record<string, ProfileLite>, p: any) => {
      acc[p.id] = p;
      return acc;
    }, {});
  }, []);

  const fromRpc = useCallback(async (hostId: UUID): Promise<ApplicantRow[] | null> => {
    try {
      const res = await supabase.rpc('get_applicants_for_host', { host_id: hostId });
      if (res.error || !Array.isArray(res.data)) return null;

      // Enrich with date info for headers
      const dateIds = Array.from(new Set(res.data.map((r: any) => r.date_id)));
      const { data: dates } = await supabase
        .from('date_requests')
        .select('id, title, location, event_date, remaining_gender_counts')
        .in('id', dateIds);

      const byId = new Map((dates || []).map((d: any) => [d.id, d]));
      const out: ApplicantRow[] = res.data.map((r: any) => {
        const d = byId.get(r.date_id) || {};
        const city = looksLikeWKTOrHex(d.location) ? null : d.location ?? null;
        return {
          row_id: r.id || `${r.date_id}:${r.applicant?.id}`,
          date_id: r.date_id,
          date_title: r.date_title ?? d.title ?? null,
          date_event_date: d.event_date ?? null,
          date_location: city,
          remaining_gender_counts: d.remaining_gender_counts || null,
          applicant: r.applicant,
        };
      });
      return out;
    } catch {
      return null;
    }
  }, []);

  const fromDirectQuery = useCallback(async (hostId: UUID): Promise<ApplicantRow[]> => {
    const { data: dates, error } = await supabase
      .from('date_requests')
      .select(
        'id, title, location, event_date, pending_users, remaining_gender_counts'
      )
      .eq('creator', hostId)
      .order('created_at', { ascending: false });

    if (error || !dates) return [];

    const eligible = (dates as DateRow[]).filter(d => {
      const pending = Array.isArray(d.pending_users) && d.pending_users.length > 0;
      const future = !isPast(d.event_date);
      const left = spotsLeft(d.remaining_gender_counts);
      const available = typeof left === 'number' ? left > 0 : true;
      return pending && future && available;
    });

    const allPendingIds = Array.from(
      new Set(
        eligible.flatMap(d => (Array.isArray(d.pending_users) ? d.pending_users : []))
      )
    ) as UUID[];

    const profMap = await fetchProfiles(allPendingIds);

    const out: ApplicantRow[] = [];
    for (const d of eligible) {
      const city = looksLikeWKTOrHex(d.location) ? null : d.location ?? null;
      for (const uid of d.pending_users || []) {
        const applicant = profMap[uid];
        if (!applicant) continue;
        out.push({
          row_id: `${d.id}:${uid}`,
          date_id: d.id,
          date_title: d.title,
          date_event_date: d.event_date,
          date_location: city,
          remaining_gender_counts: d.remaining_gender_counts || null,
          applicant,
        });
      }
    }
    return out;
  }, [fetchProfiles]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const uid = s?.session?.user?.id as UUID | undefined;
      setMe(uid ?? null);
      if (!uid) {
        setRows([]);
        return;
      }

      // Prefer RPC, fallback to direct query
      const viaRpc = await fromRpc(uid);
      const fetched = viaRpc ?? (await fromDirectQuery(uid));

      // Sort by date (most recent first), then by name
      fetched.sort((a, b) => {
        const ta = +(new Date(a.date_event_date || 0));
        const tb = +(new Date(b.date_event_date || 0));
        if (tb !== ta) return tb - ta;
        const an = (a.applicant.screenname || '').toLowerCase();
        const bn = (b.applicant.screenname || '').toLowerCase();
        return an.localeCompare(bn);
      });

      setRows(fetched);
    } catch (e) {
      console.error('[MyApplicants] load error', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fromRpc, fromDirectQuery]);

  // Realtime refresh when any visible date updates
  const attachRealtime = useCallback((ids: string[]) => {
    try { channelRef.current?.unsubscribe(); } catch {}
    channelRef.current = null;
    if (!ids.length) return;

    const ch = supabase.channel('my_applicants_dates');
    ch.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'date_requests', filter: `id=in.(${ids.join(',')})` },
      () => { load(); }
    ).subscribe(() => {});
    channelRef.current = ch;
  }, [load]);

  useEffect(() => {
    load();
    return () => { try { channelRef.current?.unsubscribe(); } catch {} };
  }, [load]);

  useEffect(() => {
    const ids = Array.from(new Set(rows.map(r => r.date_id)));
    attachRealtime(ids);
  }, [rows, attachRealtime]);

  // ------------ actions ------------
  const acceptApplicant = useCallback(async (row: ApplicantRow) => {
    try {
      // 1) Fetch current arrays
      const { data: d, error } = await supabase
        .from('date_requests')
        .select('pending_users, accepted_users, remaining_gender_counts, title')
        .eq('id', row.date_id)
        .single();
      if (error || !d) throw error || new Error('Date not found');

      const pending: string[] = Array.isArray(d.pending_users) ? d.pending_users : [];
      const accepted: string[] = Array.isArray(d.accepted_users) ? d.accepted_users : [];
      const nextPending = pending.filter((id) => id !== row.applicant.id);
      const nextAccepted = accepted.includes(row.applicant.id) ? accepted : [...accepted, row.applicant.id];

      // Decrement remaining for applicant gender if tracked
      const rgc = { ...(d.remaining_gender_counts || {}) } as Record<string, number>;
      const g = row.applicant.gender || '';
      if (g && typeof rgc[g] === 'number' && rgc[g] > 0) rgc[g] = rgc[g] - 1;

      const { error: uErr } = await supabase
        .from('date_requests')
        .update({
          pending_users: nextPending,
          accepted_users: nextAccepted,
          remaining_gender_counts: rgc,
        })
        .eq('id', row.date_id);
      if (uErr) throw uErr;

      // Optimistic remove; realtime will also refresh
      setRows(prev => prev.filter(r => r.row_id !== row.row_id));
      Alert.alert('Invited 🎉', `Accepted request for "${row.date_title || 'your date'}".`);
    } catch (e: any) {
      console.error('[MyApplicants] accept error', e);
      Alert.alert('Could not accept', e?.message || 'Try again later.');
    }
  }, []);

  const declineApplicant = useCallback(async (row: ApplicantRow) => {
    try {
      const { data: d, error } = await supabase
        .from('date_requests')
        .select('pending_users, title')
        .eq('id', row.date_id)
        .single();
      if (error || !d) throw error || new Error('Date not found');

      const pending: string[] = Array.isArray(d.pending_users) ? d.pending_users : [];
      const nextPending = pending.filter((id) => id !== row.applicant.id);

      const { error: uErr } = await supabase
        .from('date_requests')
        .update({ pending_users: nextPending })
        .eq('id', row.date_id);
      if (uErr) throw uErr;

      setRows(prev => prev.filter(r => r.row_id !== row.row_id));
    } catch (e: any) {
      console.error('[MyApplicants] decline error', e);
      Alert.alert('Could not decline', e?.message || 'Try again later.');
    }
  }, []);

  // ------------ UI helpers ------------
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

  // ------------ render ------------
  if (loading) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}><ActivityIndicator /></View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            You’re signed out. Log in to see who’s lining up for your dates. 🔑
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
            No applicants… yet. Throw a date and watch the RSVPs roll in. 🎣
          </Text>
          <TouchableOpacity onPress={() => { try { navigation.navigate('New Date'); } catch {} }} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>+ Create Date</Text>
          </TouchableOpacity>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell currentTab="My DrYnks">
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ color: '#666' }}>Swipe ➡️ to accept • Swipe ⬅️ to decline</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(it) => it.row_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        renderItem={({ item, index }) => {
          const translateX = useSharedValue(0);
          const handler = useAnimatedGestureHandler({
            onActive: (e) => { translateX.value = e.translationX; },
            onEnd: (e) => {
              if (e.translationX > 100) {
                translateX.value = withSpring(Dimensions.get('window').width, {}, () =>
                  runOnJS(acceptApplicant)(item));
              } else if (e.translationX < -100) {
                translateX.value = withSpring(-Dimensions.get('window').width, {}, () =>
                  runOnJS(declineApplicant)(item));
              } else {
                translateX.value = withSpring(0);
              }
            },
          });
          const style = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

          return (
            <PanGestureHandler onGestureEvent={handler}>
              <Animated.View
                entering={FadeInUp.delay(index * 50).duration(300)}
                style={[style, { marginBottom: 16 }]}
              >
                {/* Section header when the date changes */}
                {firstIndexByDate.get(item.date_id) === index ? <SectionHeader item={item} /> : null}

                <ProfileCard
                  user={item.applicant}
                  origin="MyApplicants"
                  onPressProfile={() =>
                    navigation.navigate('PublicProfile', { userId: item.applicant.id, origin: 'MyApplicants' })
                  }
                  onNamePress={() =>
                    navigation.navigate('PublicProfile', { userId: item.applicant.id, origin: 'MyApplicants' })
                  }
                  onInvite={() => acceptApplicant(item)}
                />
                <Text style={styles.decline} onPress={() => declineApplicant(item)}>
                  ❌ Decline this request
                </Text>
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
  primaryBtn: { backgroundColor: DRYNKS_RED, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },

  sectionHeader: { marginBottom: 8, paddingHorizontal: 6 },
  sectionTitle: { color: DRYNKS_BLUE, fontWeight: '800', fontSize: 16 },
  sectionSub: { color: '#66707A', fontSize: 12, marginTop: 2 },

  decline: { textAlign: 'center', color: '#999', fontSize: 14, marginBottom: 20, marginTop: 10 },
});

export default MyApplicantsScreen;

