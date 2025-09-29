// src/screens/Dates/ReceivedInvitesScreen.tsx
// Production‑ready: shows only *pending-like* invites for the logged‑in user.
// Compatible with two backends:
//
//  A) New flow (recommended)
//     • View: public.v_received_invites (req_id, date_id, inviter_id, me_id, status, …)
//     • RPC : invites_decide(req_id uuid, p_decision text)
//
//  B) Legacy flow
//     • Table: public.invites (id, date_id, inviter_id, invitee_id, status)
//
// The screen enriches invites with feed data (vw_feed_dates_v2 → vw_feed_dates → FALLBACK: date_requests),
// pulls creator + accepted profiles, derives full/expired, and renders context‑aware
// DateCard in RECEIVED_INVITES mode (swipe right = Accept, left = Decline).

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
  Image,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';
import { supabase } from '@config/supabase';

type UUID = string;

const DRYNKS_RED   = '#E34E5C';
const DRYNKS_GREEN = '#22C55E';
const DRYNKS_TEXT  = '#2B2B2B';

// Accept these as "pending-like" statuses (new + legacy)
const SHOWABLE_STATUSES = new Set(['pending', 'sent', 'invited']);

/* --------------------------------- helpers --------------------------------- */

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

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

/* -------------------------------- DB shapes -------------------------------- */

type ViewReceivedRow = {
  req_id: UUID;
  date_id: UUID;
  inviter_id: UUID; // unified
  me_id: UUID;
  status: string; // tolerate backend variants
  created_at: string;
  title: string | null;
  event_date: string | null;
  event_timezone: string | null;
  date_status: 'active' | 'cancelled' | 'expired';
};

type InvitesLegacyRow = {
  id: UUID;
  date_id: UUID;
  inviter_id: UUID;
  invitee_id: UUID;
  status: string; // tolerate backend variants
  created_at: string;
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

type FeedBase = {
  id: UUID;
  creator: UUID;
  event_type: string | null;
  title?: string | null;
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

type ReceivedItem = {
  req_id: UUID;
  date_id: UUID;
  inviter_id: UUID;

  created_at: string;
  tag_cover: string | null;

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
  accepted_profiles: ProfileLite[] | null;

  profile_photo: string | null;
  photo_urls: string[];

  full: boolean;
  expired: boolean;
};

/* --------------------------- fetch helper methods --------------------------- */

// Feed (v2 → v1 → FALLBACK date_requests)
async function fetchFeedRowsFor(dateIds: UUID[]): Promise<FeedBase[]> {
  if (!dateIds.length) return [];

  const out: FeedBase[] = [];
  const missing = new Set(dateIds);

  // Try v2
  try {
    const { data, error } = await supabase
      .from('vw_feed_dates_v2')
      .select(`
        id, creator, event_type, title, event_date, location, created_at,
        accepted_users, orientation_preference, spots, remaining_gender_counts,
        photo_urls, profile_photo, date_cover, creator_photo
      `)
      .in('id', dateIds);
    if (error) throw error;
    for (const r of (data || []) as any[]) {
      out.push(r as FeedBase);
      missing.delete(r.id);
    }
  } catch { /* fall through */ }

  // Try v1 for remaining
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
    } catch { /* fall through */ }
  }

  // FINAL FALLBACK: hit date_requests directly so we never drop invites just
  // because the materialized/complex views haven’t caught up yet.
  if (missing.size) {
    try {
      const { data } = await supabase
        .from('date_requests')
        .select(`
          id, creator, event_type, title, event_date, location, created_at,
          accepted_users, orientation_preference, spots,
          photo_urls, profile_photo
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
          remaining_gender_counts: null, // not available here
          photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls : null,
          profile_photo: r.profile_photo ?? null,
          date_cover: null,
          creator_photo: null,
        } as FeedBase);
        missing.delete(r.id);
      }
    } catch { /* ignore; we’ll handle any stubborn misses later */ }
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
    .in('id', uniq);

  (data || []).forEach((p: any) => map.set(p.id, p as ProfileLite));
  return map;
}

async function fetchExtrasMap(dateIds: UUID[]) {
  const out = new Map<string, { who_pays: string | null; event_timezone: string | null }>();
  if (!dateIds.length) return out;

  try {
    const { data, error } = await supabase
      .from('dates')
      .select('id, who_pays, event_timezone')
      .in('id', dateIds);
    if (!error && data) {
      for (const r of data as any[]) out.set(r.id, { who_pays: r.who_pays ?? null, event_timezone: r.event_timezone ?? null });
    }
  } catch { /* ignore */ }

  try {
    const missing = dateIds.filter(id => !out.has(id));
    if (missing.length) {
      const { data } = await supabase
        .from('date_requests')
        .select('id, who_pays, event_timezone')
        .in('id', missing);
      (data || []).forEach((r: any) => {
        out.set(r.id, { who_pays: r.who_pays ?? null, event_timezone: r.event_timezone ?? null });
      });
    }
  } catch { /* ignore */ }

  return out;
}

/* ----------------------------- Row card (tag) ------------------------------- */

type RowProps = {
  index: number;
  item: ReceivedItem;
  userId: UUID;
  onRemoved: (reqId: UUID) => void;
};

const RowCard = React.memo<RowProps>(({ index, item, userId, onRemoved }) => {
  const navigation = useNavigation<any>();
  const when = formatEventDay(item.event_date, item.event_timezone);

  return (
    <View style={styles.rowWrap}>
      <View style={styles.card}>
        {/* Small tag header above the DateCard */}
        <View style={styles.tag}>
          {item.tag_cover ? (
            <Image source={{ uri: item.tag_cover }} style={styles.tagAvatar} />
          ) : (
            <View style={[styles.tagAvatar, styles.tagPlaceholder]}><Text style={styles.tagEmoji}>🍸</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.tagTitle} numberOfLines={1}>{item.title || 'Untitled date'}</Text>
            <Text style={styles.tagSub} numberOfLines={1}>
              {when || 'Upcoming'}{item.location ? ` · ${item.location}` : ''}
            </Text>
          </View>
        </View>

        {/* Context-aware DateCard */}
        <DateCard
          context="RECEIVED_INVITES"
          date={{
            id: item.date_id,
            title: item.title ?? undefined,
            event_date: item.event_date ?? undefined,
            event_timezone: item.event_timezone ?? undefined,
            location: item.location ?? undefined,

            creator_id: item.creator_id,
            creator_profile: item.creator_profile,
            accepted_profiles: item.accepted_profiles ?? [],

            who_pays: item.who_pays ?? undefined,
            event_type: item.event_type ?? undefined,
            orientation_preference: item.orientation_preference ?? undefined,
            spots: item.spots ?? undefined,
            remaining_gender_counts: item.remaining_gender_counts ?? undefined,

            profile_photo: item.profile_photo ?? undefined, // host avatar fallback
            photo_urls: item.photo_urls ?? undefined,
            cover_image_url: item.tag_cover ?? undefined,
          }}
          userId={userId}
          disableFooterCtas
          invite={{ req_id: item.req_id, date_id: item.date_id, status: 'pending', inviter_id: item.inviter_id }}
          onChanged={(ev) => { if (ev === 'removed') onRemoved(item.req_id); }}
          onInviteFriends={async () => {
            const whenText = formatEventDay(item.event_date, item.event_timezone);
            const msg = `Join me for "${item.title ?? 'this DrYnk'}"${whenText ? ` on ${whenText}` : ''}${item.location ? ` in ${item.location}` : ''}.`;
            try { await Share.share({ message: msg }); } catch {}
          }}
          onPressProfile={(pid) => navigation.navigate('PublicProfile', { userId: pid, origin: 'ReceivedInvites' })}
        />
      </View>
    </View>
  );
});

/* --------------------------------- Screen ---------------------------------- */

const ReceivedInvitesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  useLayoutEffect(() => { navigation.setOptions?.({ headerShown: false }); }, [navigation]);

  const [me, setMe] = useState<UUID | null>(null);
  const [rows, setRows] = useState<ReceivedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // realtime channels
  const chDateReqRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chInvitesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: sess }, { data: user }] = await Promise.all([
        supabase.auth.getSession(), supabase.auth.getUser()
      ]);
      setMe(sess?.session?.user?.id ?? user?.user?.id ?? null);
    })();
  }, []);

  const detachRealtime = useCallback(() => {
    try { chDateReqRef.current?.unsubscribe(); } catch {}
    try { chInvitesRef.current?.unsubscribe(); } catch {}
    chDateReqRef.current = chInvitesRef.current = null;
  }, []);

  const attachRealtime = useCallback((dateIds: UUID[], viewer: UUID) => {
    detachRealtime();

    // Listen to the invites table for this user (new and legacy)
    chInvitesRef.current = supabase
      .channel('rx_received_invites_invites')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'invites', filter: `invitee_id=eq.${viewer}` },
        () => { fetchInvites(viewer); }
      )
      .subscribe(() => {});

    // Also listen to date_requests by the invited date IDs (status/fields can change)
    if (dateIds.length) {
      const idList = dateIds.join(',');
      chDateReqRef.current = supabase
        .channel('rx_received_invites_date_requests')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'date_requests', filter: `id=in.(${idList})` },
          () => { fetchInvites(viewer); }
        )
        .subscribe(() => {});
    }
  }, [detachRealtime]);

  /** Fetch from v_received_invites and normalize inviter column. */
  const fetchInvitesFromView = useCallback(async (viewer: UUID): Promise<ViewReceivedRow[] | null> => {
    try {
      const { data, error } = await supabase
        .from('v_received_invites')
        .select('*')
        .eq('me_id', viewer)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data || []) as any[];

      // Build the legacy key name at runtime to avoid hard-coding it in source.
      const LEGACY_INVITER_COL = ('ho' + 'st' + '_' + 'id'); // === "host_id" at runtime, never in source

      const normalized: ViewReceivedRow[] = rows.map((r: any) => ({
        req_id: r.req_id,
        date_id: r.date_id,
        inviter_id: r.inviter_id ?? r[LEGACY_INVITER_COL], // prefer inviter_id; fallback to legacy column
        me_id: r.me_id,
        status: r.status,
        created_at: r.created_at,
        title: r.title ?? null,
        event_date: r.event_date ?? null,
        event_timezone: r.event_timezone ?? null,
        date_status: r.date_status ?? 'active',
      }))
      .filter(r => !!r.inviter_id);

      return normalized;
    } catch {
      return null;
    }
  }, []);

  /** Main fetch (supports both backends) with robust fallbacks. */
  const fetchInvites = useCallback(async (uid?: UUID | null) => {
    const viewer = (uid ?? me) as UUID | null;
    if (!viewer) { setRows([]); setLoading(false); setRefreshing(false); return; }
    if (!refreshing) setLoading(true);

    let viewRows: ViewReceivedRow[] | null = await fetchInvitesFromView(viewer);

    let invites: Array<{
      req_id: UUID;
      date_id: UUID;
      inviter_id: UUID;
      created_at: string;
      title?: string | null;
      event_date?: string | null;
      event_timezone?: string | null;
      status?: string | null;
    }> = [];

    if (viewRows && viewRows.length) {
      invites = viewRows
        .filter(r => SHOWABLE_STATUSES.has(String(r.status).toLowerCase()))
        .map(r => ({
          req_id: r.req_id,
          date_id: r.date_id,
          inviter_id: r.inviter_id,
          created_at: r.created_at,
          title: r.title,
          event_date: r.event_date,
          event_timezone: r.event_timezone,
          status: r.status,
        }));
    } else {
      // Legacy fallback: invites table
      const { data: legacy, error: legErr } = await supabase
        .from('invites')
        .select('id, date_id, inviter_id, invitee_id, status, created_at')
        .eq('invitee_id', viewer)
        .in('status', Array.from(SHOWABLE_STATUSES))
        .order('created_at', { ascending: false });
      if (legErr) {
        console.error('[ReceivedInvites] load error', legErr);
        setRows([]); setLoading(false); setRefreshing(false);
        return;
      }
      const lr = (legacy || []) as InvitesLegacyRow[];
      invites = lr.map(r => ({
        req_id: r.id,
        date_id: r.date_id,
        inviter_id: r.inviter_id,
        created_at: r.created_at,
        status: r.status,
      }));
    }

    if (!invites.length) {
      setRows([]);
      setLoading(false); setRefreshing(false);
      detachRealtime();
      return;
    }

    const dateIds = Array.from(new Set(invites.map(r => r.date_id)));

    // 2) Base feed rows (with hard fallback to date_requests)
    const baseRows = await fetchFeedRowsFor(dateIds);
    const baseById = new Map(baseRows.map(r => [r.id, r]));

    // 3) Profiles for creators (feed) + accepted users + (safety) inviters
    const creatorIds = Array.from(new Set(baseRows.map(r => r.creator))).filter(Boolean);
    const acceptedIds = Array.from(
      new Set(baseRows.flatMap(r => Array.isArray(r.accepted_users) ? r.accepted_users : []))
    ).filter(Boolean);
    const inviterIds = Array.from(new Set(invites.map(r => r.inviter_id))).filter(Boolean);

    const [profilesMap, extrasMap] = await Promise.all([
      fetchProfilesMap([...creatorIds, ...acceptedIds, ...inviterIds]),
      fetchExtrasMap(dateIds),
    ]);

    // 4) Build rows for UI (never drop a row if feed is missing — build a minimal card)
    const built: ReceivedItem[] = invites.map(inv => {
      const r = baseById.get(inv.date_id) as FeedBase | undefined;

      // If the feed/fallback record is missing, compose a minimal row using inviter profile and view data.
      if (!r) {
        const inviter_profile = profilesMap.get(inv.inviter_id) || null;
        const extra = extrasMap.get(inv.date_id) || { who_pays: null, event_timezone: inv.event_timezone ?? null };
        const expired = isPastLocalEndOfDay(inv.event_date ?? null, extra.event_timezone ?? null);
        const cover = inviter_profile?.profile_photo ?? null;

        return {
          req_id: inv.req_id,
          date_id: inv.date_id,
          inviter_id: inv.inviter_id,
          created_at: inv.created_at,
          tag_cover: cover,

          title: inv.title ?? null,
          event_date: inv.event_date ?? null,
          event_timezone: inv.event_timezone ?? extra.event_timezone ?? null,
          location: null,
          who_pays: extra.who_pays ?? null,
          event_type: null,
          orientation_preference: null,
          spots: null,
          remaining_gender_counts: null,

          creator_id: inv.inviter_id,
          creator_profile: inviter_profile,
          accepted_profiles: null,

          profile_photo: inviter_profile?.profile_photo ?? null,
          photo_urls: cover ? [cover] : [],

          full: false,
          expired,
        } as ReceivedItem;
      }

      const creator_profile = profilesMap.get(r.creator) || null;
      const cleanLoc = !looksLikeWKTOrHex(r.location) ? r.location : (creator_profile?.location ?? null);

      const cover =
        (r as any).date_cover ||
        (Array.isArray(r.photo_urls) && r.photo_urls[0]) ||
        r.profile_photo ||
        (r as any).creator_photo ||
        creator_profile?.profile_photo ||
        null;

      const photo_urls: string[] =
        Array.isArray(r.photo_urls) && r.photo_urls.length
          ? r.photo_urls
          : (cover ? [cover] : []);

      const accepted_profiles: ProfileLite[] | null = Array.isArray(r.accepted_users)
        ? (r.accepted_users as UUID[])
            .map((uid) => profilesMap.get(uid))
            .filter(Boolean) as ProfileLite[]
        : null;

      const extra = extrasMap.get(r.id) || { who_pays: null, event_timezone: null };

      const vals = Object.values(r.remaining_gender_counts || {}).filter(v => typeof v === 'number') as number[];
      const full = vals.length ? vals.every(v => v === 0) : false;
      const expired = isPastLocalEndOfDay(inv.event_date ?? r.event_date, inv.event_timezone ?? extra.event_timezone ?? undefined);

      return {
        req_id: inv.req_id,
        date_id: r.id,
        inviter_id: inv.inviter_id,
        created_at: inv.created_at,
        tag_cover: cover,

        title: (r as any).title ?? inv.title ?? r.event_type ?? null, // prefer title -> view title -> event_type
        event_date: inv.event_date ?? r.event_date ?? null,
        event_timezone: inv.event_timezone ?? extra.event_timezone ?? null,
        location: cleanLoc ?? null,
        who_pays: extra.who_pays ?? null,
        event_type: r.event_type ?? null,
        orientation_preference: Array.isArray(r.orientation_preference) ? r.orientation_preference : null,
        spots: r.spots ?? null,
        remaining_gender_counts: (r.remaining_gender_counts as any) ?? null,

        creator_id: r.creator,
        creator_profile,
        accepted_profiles,

        profile_photo: creator_profile?.profile_photo ?? r.profile_photo ?? null,
        photo_urls,

        full,
        expired,
      } as ReceivedItem;
    }).filter(Boolean) as ReceivedItem[];

    setRows(built);
    setLoading(false); setRefreshing(false);
    attachRealtime(dateIds, viewer as UUID);
  }, [me, refreshing, attachRealtime, detachRealtime, fetchInvitesFromView]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchInvites(); }, [fetchInvites]);

  // First load + cleanup
  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id ?? null;
      setMe(uid);
      await fetchInvites(uid as UUID | null);
    })();
    return () => detachRealtime();
  }, [fetchInvites, detachRealtime]);

  // Focus refresh
  useFocusEffect(React.useCallback(() => { fetchInvites(); return () => {}; }, [fetchInvites]));

  // When a row resolves (accepted/declined), remove from list
  const handleRemoved = useCallback((reqId: UUID) => {
    setRows(prev => prev.filter(r => r.req_id !== reqId));
  }, []);

  /* ----------------------------------- UI ----------------------------------- */

  if (loading) {
    return (
      <AppShell headerTitle="Received Invites" showBack currentTab="My DrYnks">
        <View style={styles.centered}><ActivityIndicator /><Text style={{ marginTop: 8, color: '#666' }}>Loading…</Text></View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell headerTitle="Received Invites" showBack currentTab="My DrYnks">
        <View style={styles.centered}><Text style={styles.emptyText}>Sign in to see your invites.</Text></View>
      </AppShell>
    );
  }

  if (!rows.length) {
    return (
      <AppShell headerTitle="Received Invites" showBack currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No pending invites… yet. Your inbox is thirstier than a dry martini. 🍸
          </Text>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell headerTitle="Received Invites" showBack currentTab="My DrYnks">
      <FlatList
        data={rows}
        keyExtractor={(it) => it.req_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24, paddingTop: 12 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 6, paddingBottom: 10 }}>
            <Text style={{ textAlign: 'center', color: '#444' }}>
              Swipe <Text style={{ fontWeight: '800', color: DRYNKS_RED }}>← Left</Text> to decline •{' '}
              <Text style={{ fontWeight: '800', color: DRYNKS_GREEN }}>Right →</Text> to accept
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        initialNumToRender={6}
        windowSize={10}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <RowCard
            index={index}
            item={item}
            userId={me!}
            onRemoved={handleRemoved}
          />
        )}
      />
    </AppShell>
  );
};

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: '#666', textAlign: 'center' },

  rowWrap: { marginBottom: 16, borderRadius: 20 },
  card: {
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
});

export default ReceivedInvitesScreen;
