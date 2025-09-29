// src/screens/Dates/JoinRequestsScreen.tsx
// Production-ready (RN 0.81 safe; no RNGH gestures).
// HOST VIEW: shows all *incoming* pending join requests for dates I created.
// - Grouped by date (title/time/location cover).
// - Each requester appears as a profile card with Accept / Decline.
// - Realtime: join_requests (recipient_id = me) + dates updates/deletes.
// - Feed fallback: vw_feed_dates_v2 -> vw_feed_dates -> date_requests (never drop rows).

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Platform,
  Image,
  TouchableOpacity,
  SectionList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';
import { notifyJoinRequestAccepted as notifyJoinRequestAcceptedPush } from '@services/NotificationService';

type UUID = string;

const DRYNKS_RED   = '#E34E5C';
const DRYNKS_GREEN = '#22C55E';
const DRYNKS_TEXT  = '#2B2B2B';
const CHIP_BG      = Platform.select({ ios: '#F8FAFB', android: '#F2F5F7', default: '#F2F5F7' });

/* ─────────────────────────── date/time helpers ─────────────────────────── */

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

function isPastLocalEndOfDay(eventISO?: string | null, timeZone?: string | null): boolean {
  if (!eventISO) return false;
  try {
    const event = new Date(eventISO);
    if (!Number.isFinite(event.valueOf())) return false;
    if (!timeZone) return event.getTime() < Date.now();
    const e = getYMDInTZ(event, timeZone);
    const n = getYMDInTZ(new Date(), timeZone);
    return (n.y * 10000 + n.m * 100 + n.d) > (e.y * 10000 + e.m * 100 + e.d);
  } catch {
    const d = new Date(eventISO);
    return Number.isFinite(d.valueOf()) && d.getTime() < Date.now();
  }
}

function formatEventDay(eventISO?: string | null, timeZone?: string | null): string | null {
  if (!eventISO) return null;
  try {
    const d = new Date(eventISO);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC', weekday: 'short', month: 'short', day: 'numeric',
    }).format(d);
  } catch { return null; }
}

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

/* ─────────────────────────────── DB shapes ─────────────────────────────── */

type JoinRow = {
  id: UUID;
  status: 'pending' | 'accepted' | 'cancelled' | 'dismissed' | 'removed_by_host' | string;
  requester_id: UUID;
  recipient_id: UUID; // host (you)
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

/* ───────────────────── data fetchers (robust) ───────────────────── */

async function fetchFeedRowsFor(dateIds: UUID[]): Promise<FeedBase[]> {
  if (!dateIds.length) return [];
  const out: FeedBase[] = [];
  const missing = new Set(dateIds);

  // v2
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
    for (const r of (data || []) as any[]) {
      out.push(r as FeedBase);
      missing.delete(r.id);
    }
  } catch { /* fallback */ }

  // v1
  if (missing.size) {
    try {
      const { data } = await supabase
        .from('vw_feed_dates')
        .select(`
          id, creator, event_type, event_date, location, created_at,
          accepted_users, orientation_preference, spots, remaining_gender_counts,
          photo_urls, profile_photo
        `)
        .in('id', Array.from(missing));
      for (const r of (data || []) as any[]) {
        out.push(r as FeedBase);
        missing.delete(r.id);
      }
    } catch { /* fallback */ }
  }

  // final: date_requests so we never drop brand‑new rows
  if (missing.size) {
    try {
      const { data } = await supabase
        .from('date_requests')
        .select(`
          id, creator, event_type, title, event_date, location, created_at,
          accepted_users, orientation_preference, spots, photo_urls, profile_photo
        `)
        .in('id', Array.from(missing));
      for (const r of (data || []) as any[]) {
        out.push({
          id: r.id,
          creator: r.creator,
          event_type: r.event_type ?? null,
          title: r.title ?? null,
          event_date: r.event_date ?? null,
          location: r.location ?? null,
          created_at: r.created_at ?? null,
          accepted_users: Array.isArray(r.accepted_users) ? r.accepted_users : null,
          orientation_preference: Array.isArray(r.orientation_preference) ? r.orientation_preference : null,
          spots: typeof r.spots === 'number' ? r.spots : null,
          remaining_gender_counts: null,
          photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls : null,
          profile_photo: r.profile_photo ?? null,
          date_cover: null,
          creator_photo: null,
        } as FeedBase);
        missing.delete(r.id);
      }
    } catch { /* ignore */ }
  }

  return out;
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

/* ─────────────────────── derived UI types ─────────────────────── */

type RequesterCard = {
  req_id: UUID;
  requester_id: UUID;
  created_at: string;
  requester: ProfileLite | null;
};

type DateSection = {
  date_id: UUID;
  title: string | null;
  event_date: string | null;
  event_timezone: string | null;
  location: string | null;
  who_pays: string | null;

  cover_image_url: string | null;
  host_id: UUID;
  host_profile: ProfileLite | null;

  data: RequesterCard[]; // SectionList requires 'data'
};

/* ────────────────────────── small UI bits ────────────────────────── */

const Avatar: React.FC<{ uri?: string | null; size?: number }> = ({ uri, size = 44 }) => (
  uri
    ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: Math.round(size/2), backgroundColor: '#EEE' }} />
    : <View style={{ width: size, height: size, borderRadius: Math.round(size/2), backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#6B7280', fontWeight: '700' }}>?</Text>
      </View>
);

const Pill: React.FC<{ color?: string; bg?: string; text: string }> = ({ color = '#1F2937', bg = CHIP_BG!, text }) => (
  <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
    <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{text}</Text>
  </View>
);

/* ─────────────────────────── request card ─────────────────────────── */

const RequesterRow: React.FC<{
  req: RequesterCard;
  onAccept: (req: RequesterCard) => void;
  onDecline: (req: RequesterCard) => void;
}> = ({ req, onAccept, onDecline }) => {
  return (
    <View style={styles.reqRow}>
      <Avatar uri={req.requester?.profile_photo ?? null} size={48} />
      <View style={{ flex: 1, marginHorizontal: 10 }}>
        <Text style={styles.reqName} numberOfLines={1}>
          {req.requester?.screenname || 'New member'}
        </Text>
        <Text style={styles.reqSub} numberOfLines={1}>
          Requested {new Date(req.created_at).toLocaleDateString()}
        </Text>
      </View>
      <TouchableOpacity onPress={() => onDecline(req)} style={[styles.actionBtn, { backgroundColor: '#FFE4E6' }]}>
        <Ionicons name="close" size={18} color="#991B1B" />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onAccept(req)} style={[styles.actionBtn, { backgroundColor: '#DCFCE7', marginLeft: 8 }]}>
        <Ionicons name="checkmark" size={18} color="#166534" />
      </TouchableOpacity>
    </View>
  );
};

/* ────────────────────────────── screen ────────────────────────────── */

const JoinRequestsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  useLayoutEffect(() => { navigation.setOptions?.({ headerShown: false }); }, [navigation]);

  const [me, setMe] = useState<UUID | null>(null);
  const [sections, setSections] = useState<DateSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // realtime channels
  const chReqRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDatesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const detachRealtime = useCallback(() => {
    try { chReqRef.current?.unsubscribe(); } catch {}
    try { chDatesRef.current?.unsubscribe(); } catch {}
    chReqRef.current = null; chDatesRef.current = null;
  }, []);

  const attachRealtime = useCallback((viewer: UUID, dateIds: UUID[]) => {
    detachRealtime();

    // join_requests where I'm the recipient (host)
    chReqRef.current = supabase
      .channel('rx_host_join_requests')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'join_requests', filter: `recipient_id=eq.${viewer}` },
        async (payload: any) => {
          const jr = payload?.new as JoinRow | undefined;
          if (!jr || String(jr.status).toLowerCase() !== 'pending') return;
          await mergeNewJoinRow(jr);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'join_requests', filter: `recipient_id=eq.${viewer}` },
        (payload: any) => {
          const next = payload?.new as JoinRow | undefined;
          if (!next) return;
          if (String(next.status).toLowerCase() !== 'pending') {
            setSections(prev => removeRequest(prev, next.id));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'join_requests', filter: `recipient_id=eq.${viewer}` },
        (payload: any) => {
          const old = payload?.old as JoinRow | undefined;
          if (!old?.id) return;
          setSections(prev => removeRequest(prev, old.id));
        }
      )
      .subscribe(() => {});

    if (dateIds.length) {
      const idList = dateIds.join(',');
      chDatesRef.current = supabase
        .channel('rx_host_join_requests_dates')
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'dates', filter: `id=in.(${idList})` },
          (payload: any) => {
            const old = payload?.old as any;
            if (old?.id) setSections(prev => prev.filter(s => s.date_id !== old.id));
          }
        )
        .subscribe(() => {});
    }
  }, [detachRealtime]);

  /* ――― utilities to mutate sections ――― */

  function removeRequest(prev: DateSection[], reqId: UUID): DateSection[] {
    const next = prev.map(sec => ({ ...sec, data: sec.data.filter(r => r.req_id !== reqId) }))
                     .filter(sec => sec.data.length > 0);
    return next;
  }

  async function mergeNewJoinRow(jr: JoinRow) {
    // Load minimal data for this single row
    const [feed, whoPays, requesterProfile] = await Promise.all([
      fetchFeedRowsFor([jr.date_id]).then(rows => rows[0]),
      fetchWhoPaysMap([jr.date_id]).then(m => m.get(jr.date_id) || { who_pays: null, event_timezone: null }),
      fetchProfilesMap([jr.requester_id]).then(m => m.get(jr.requester_id) || null),
    ]);

    // If feed row is still missing, try date_requests (already part of fetchFeedRowsFor fallback).
    if (!feed) return;

    const when = formatEventDay(feed.event_date, (whoPays as any)?.event_timezone ?? null);
    const cover =
      (feed as any).date_cover ||
      (Array.isArray(feed.photo_urls) && feed.photo_urls[0]) ||
      feed.profile_photo ||
      (feed as any).creator_photo ||
      null;

    const secBase: Omit<DateSection, 'data'> = {
      date_id: feed.id,
      title: (feed as any).title ?? feed.event_type ?? null,
      event_date: feed.event_date ?? null,
      event_timezone: (whoPays as any)?.event_timezone ?? null,
      location: !looksLikeWKTOrHex(feed.location) ? (feed.location ?? null) : null,
      who_pays: (whoPays as any)?.who_pays ?? null,
      cover_image_url: cover,
      host_id: feed.creator,
      host_profile: null, // could fetch if needed; not required here
    };

    const card: RequesterCard = {
      req_id: jr.id,
      requester_id: jr.requester_id,
      created_at: jr.created_at,
      requester: requesterProfile,
    };

    setSections(prev => {
      const idx = prev.findIndex(s => s.date_id === feed.id);
      if (idx === -1) return [{ ...secBase, data: [card] }, ...prev];
      const exists = prev[idx].data.some(r => r.req_id === card.req_id);
      if (exists) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], data: [card, ...next[idx].data] };
      return next;
    });
  }

  /* ――― fetch initial (host‑side) rows ――― */

  const fetchRows = useCallback(async (uid?: UUID | null) => {
    const viewer = (uid ?? me) as UUID | null;
    if (!viewer) {
      setSections([]); setLoading(false); setRefreshing(false); detachRealtime(); return;
    }
    if (!refreshing) setLoading(true);

    // 1) rows where I'm the recipient (host): pending requests
    const { data, error } = await supabase
      .from('join_requests')
      .select('id, status, requester_id, recipient_id, date_id, created_at')
      .eq('recipient_id', viewer)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[JoinRequests(host)] fetch error', error);
      setSections([]); setLoading(false); setRefreshing(false);
      return;
    }

    const joinRows = (data || []) as JoinRow[];
    if (!joinRows.length) {
      setSections([]); setLoading(false); setRefreshing(false);
      attachRealtime(viewer, []);
      return;
    }

    const dateIds = Array.from(new Set(joinRows.map(r => r.date_id)));
    const requesterIds = Array.from(new Set(joinRows.map(r => r.requester_id)));

    // 2) date feed/base
    const [feedRows, profilesMap, whoPaysMap] = await Promise.all([
      fetchFeedRowsFor(dateIds),
      fetchProfilesMap(requesterIds),
      fetchWhoPaysMap(dateIds),
    ]);
    const feedById = new Map(feedRows.map(r => [r.id, r]));

    // 3) build grouped sections
    const map = new Map<UUID, DateSection>();
    for (const jr of joinRows) {
      const r = feedById.get(jr.date_id);
      if (!r) continue;

      const wp = whoPaysMap.get(r.id) || { who_pays: null, event_timezone: null };
      const cover =
        (r as any).date_cover ||
        (Array.isArray(r.photo_urls) && r.photo_urls[0]) ||
        r.profile_photo ||
        (r as any).creator_photo ||
        null;

      if (!map.has(r.id)) {
        map.set(r.id, {
          date_id: r.id,
          title: (r as any).title ?? r.event_type ?? null,
          event_date: r.event_date ?? null,
          event_timezone: wp.event_timezone ?? null,
          location: !looksLikeWKTOrHex(r.location) ? (r.location ?? null) : null,
          who_pays: wp.who_pays ?? null,
          cover_image_url: cover,
          host_id: r.creator,
          host_profile: null,
          data: [],
        });
      }

      const sec = map.get(r.id)!;
      sec.data.push({
        req_id: jr.id,
        requester_id: jr.requester_id,
        created_at: jr.created_at,
        requester: profilesMap.get(jr.requester_id) || null,
      });
    }

    // newest sections first; inside each, newest requests first
    const sectionsBuilt = Array.from(map.values())
      .map(s => ({ ...s, data: s.data.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) }))
      .sort((a, b) => ((a.event_date || '') < (b.event_date || '') ? 1 : -1));

    setSections(sectionsBuilt);
    setLoading(false); setRefreshing(false);
    attachRealtime(viewer, dateIds);
  }, [me, refreshing, attachRealtime, detachRealtime]);

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

  /* ─────────────────────────── actions ─────────────────────────── */

  const acceptRequest = useCallback(async (req: RequesterCard, section: DateSection) => {
    try {
      const { error } = await supabase
        .from('join_requests')
        .update({ status: 'accepted' })
        .eq('id', req.req_id);
      if (error) throw error;

      // optimistic UI
      setSections(prev => removeRequest(prev, req.req_id));

      // optional push/bell to requester
      try {
        await notifyJoinRequestAcceptedPush?.({
          requesterId: req.requester_id,
          dateId: section.date_id,
          eventTitle: section.title ?? 'Your request',
        });
      } catch { /* non-fatal */ }
    } catch (e: any) {
      console.error('[JoinRequests(host)] accept error', e);
      Alert.alert('Error', e?.message || 'Could not accept the request.');
    }
  }, []);

  const declineRequest = useCallback(async (req: RequesterCard) => {
    try {
      const { error } = await supabase
        .from('join_requests')
        .update({ status: 'dismissed' })
        .eq('id', req.req_id);
      if (error) throw error;

      // optimistic UI
      setSections(prev => removeRequest(prev, req.req_id));
    } catch (e: any) {
      console.error('[JoinRequests(host)] decline error', e);
      Alert.alert('Error', e?.message || 'Could not decline the request.');
    }
  }, []);

  /* ─────────────────────────── UI branches ─────────────────────────── */

  if (loading) {
    return (
      <AppShell headerTitle="Join Requests" showBack currentTab="My DrYnks">
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: '#666' }}>Loading join requests…</Text>
        </View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell headerTitle="Join Requests" showBack currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Sign in to view requests for your dates.</Text>
        </View>
      </AppShell>
    );
  }

  if (!sections.length) {
    return (
      <AppShell headerTitle="Join Requests" showBack currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No pending join requests right now.</Text>
        </View>
      </AppShell>
    );
  }

  /* ───────────────────────────── main UI ───────────────────────────── */

  return (
    <AppShell headerTitle="Join Requests" showBack currentTab="My DrYnks">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.req_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderSectionHeader={({ section }) => {
          const when = formatEventDay(section.event_date, section.event_timezone);
          return (
            <View style={styles.section}>
              {/* Tag header */}
              <View style={styles.tag}>
                {section.cover_image_url
                  ? <Image source={{ uri: section.cover_image_url }} style={styles.tagAvatar} />
                  : <View style={[styles.tagAvatar, styles.tagPlaceholder]}><Text style={styles.tagEmoji}>🍸</Text></View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={styles.tagTitle} numberOfLines={1}>{section.title || 'Untitled date'}</Text>
                  <Text style={styles.tagSub} numberOfLines={1}>
                    {when || 'Upcoming'}{section.location ? ` · ${section.location}` : ''}
                  </Text>
                </View>
                {section.who_pays ? <Pill text={section.who_pays === 'host' ? 'I pay' : section.who_pays} /> : null}
              </View>

              {/* DateCard (host context) */}
              <DateCard
                context="JOIN_REQUESTS_HOST"
                date={{
                  id: section.date_id,
                  title: section.title ?? undefined,
                  event_date: section.event_date ?? undefined,
                  event_timezone: section.event_timezone ?? undefined,
                  location: section.location ?? undefined,

                  creator_id: section.host_id,
                  creator_profile: section.host_profile ?? undefined,
                  accepted_profiles: [],

                  who_pays: section.who_pays ?? undefined,
                  event_type: undefined,
                  orientation_preference: undefined,
                  spots: undefined,
                  remaining_gender_counts: undefined,

                  profile_photo: section.host_profile?.profile_photo ?? undefined,
                  photo_urls: undefined,
                  cover_image_url: section.cover_image_url ?? undefined,
                }}
                userId={me}
                isCreator
                disableFooterCtas
              />
            </View>
          );
        }}
        renderItem={({ item, section }) => (
          <RequesterRow
            req={item}
            onAccept={(r) => acceptRequest(r, section as DateSection)}
            onDecline={declineRequest}
          />
        )}
        SectionSeparatorComponent={() => <View style={{ height: 24 }} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </AppShell>
  );
};

/* ────────────────────────────── styles ────────────────────────────── */

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#555', fontSize: 16, textAlign: 'center' },

  section: {
    marginBottom: 12,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
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
  tagAvatar: { width: 28, height: 28, borderRadius: 6, marginRight: 8, backgroundColor: '#EEE' },
  tagPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  tagEmoji: { fontSize: 16 },
  tagTitle: { color: DRYNKS_TEXT, fontWeight: '700' },
  tagSub: { color: '#6B7280', fontSize: 12, marginTop: 1 },

  reqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    marginHorizontal: 4,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
      android: { elevation: 1 },
    }),
  },
  reqName: { color: '#111827', fontSize: 15, fontWeight: '700' },
  reqSub: { color: '#6B7280', fontSize: 12, marginTop: 2 },

  actionBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
});

export default JoinRequestsScreen;
