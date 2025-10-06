// My Sent Invites — production-ready, RPC-based rescind + lean realtime.
// - PRIMARY: v_sent_invites (already scoped by auth.uid())
// - FALLBACKS: date_requests (authoritative) → invites (legacy only for hydration)
// - Rescind uses public.invites_decide(req_id,'rescinded') and optimistically prunes UI.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import ProfileCard from '@components/cards/ProfileCard';
import { notifyInviteRevoked } from '@services/NotificationService';

type UUID = string;

const DRYNKS_RED  = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_TEXT = '#2B2B2B';

// We show only "pending-like" rows (view/legacy may label them differently)
const SHOWABLE_STATUSES = new Set(['pending', 'sent', 'invited']);

/* -------------------------------- helpers -------------------------------- */

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const sumRemaining = (rgc?: Record<string, number> | null) =>
  Object.values(rgc ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

function parseRemainingCounts(v: unknown): Record<string, number> | null {
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, number>;
  if (typeof v === 'string') {
    try { const o = JSON.parse(v); return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, number>) : null; }
    catch { return null; }
  }
  return null;
}

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

/** Parse gallery_photos robustly across jsonb/text[]/string */
const toStringArray = (v: any): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('[')) { try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr.map(String) : []; } catch {} }
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1);
      const out: string[] = [];
      let buf = '', q = false;
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '"') { if (q && inner[i+1] === '"') { buf += '"'; i++; } else { q = !q; } continue; }
        if (ch === ',' && !q) { out.push(buf); buf=''; continue; }
        buf += ch;
      }
      out.push(buf);
      return out.map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
};

/* ---------------------------- DB shapes ----------------------------- */

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
  creator_id?: UUID | null; user_id?: UUID | null; uid?: UUID | null;
  spots?: number | null;
  remaining_gender_counts?: any;
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

/* ------------- normalization of recipient ids (profile + auth) ------------- */

type PendingCore = {
  req_id: UUID;             // SHOULD be date_requests.id when coming from view/date_requests
  date_id: UUID;
  created_at: string;
  recipient_profile_id?: UUID | null;
  recipient_auth_id?: UUID | null;
  _title?: string | null;
  _event_date?: string | null;
  _event_tz?: string | null;
};

const readStr = (v: any): string | null =>
  typeof v === 'string' && v.length >= 8 ? v : null;

/** Treat invitee_id/recipient_id as PROFILE ids (matches ManageApplicants). */
const extractRecipientIds = (row: any): { profileId?: UUID | null; authId?: UUID | null } => {
  const profileId =
    readStr(row.recipient_profile_id) ??
    readStr(row.invitee_profile_id) ??
    readStr(row.profile_id) ??
    readStr(row.applicant_id) ??
    readStr(row.recipient_profile) ??
    readStr(row.invitee_profile) ??
    readStr(row.invitee_id) ??          // legacy; we treat as profiles.id
    readStr(row.recipient_id) ?? null;  // legacy; we treat as profiles.id

  const authId =
    readStr(row.user_id) ??
    readStr(row.uid) ??
    readStr(row.requester_id) ??
    readStr(row.recipient_user_id) ??
    readStr(row.invitee_user_id) ?? null;

  return { profileId, authId };
};

/* ----------------------- small presentational bits ----------------------- */

const DateTag: React.FC<{ title: string | null; event_date: string | null; tz: string | null; location: string | null; photo: string | null; disabled?: boolean }> = ({ title, event_date, tz, location, photo, disabled }) => {
  const day = formatEventDay(event_date, tz);
  return (
    <View style={[styles.dateTag, disabled && { opacity: 0.55 }]}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.dateTagAvatar} />
      ) : (
        <View style={[styles.dateTagAvatar, styles.dateTagPlaceholder]}>
          <Text style={styles.dateTagEmoji}>🍸</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.dateTagTitle} numberOfLines={1}>
          {title || 'Untitled date'}
        </Text>
        <Text style={styles.dateTagSub} numberOfLines={1}>
          {day ? `${day}` : 'Upcoming'}{location ? ` · ${location}` : ''}
        </Text>
      </View>
    </View>
  );
};

const RescindButton: React.FC<{ onPress: () => void; disabled?: boolean }> = ({ onPress, disabled }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={[styles.rescindBtn, disabled && { opacity: 0.6 }]}
    accessibilityRole="button"
    accessibilityLabel="Rescind invite"
  >
    <Ionicons name="arrow-undo-outline" size={16} color="#166534" />
    <Text style={styles.rescindText}>Rescind</Text>
  </TouchableOpacity>
);

/* ------------------------------- Screen ------------------------------- */

type SentItem = {
  req_id: UUID; // expected to be date_requests.id (from view or dr fallback)
  date_id: UUID;
  created_at: string;
  recipient_profile_id?: UUID | null;
  recipient_auth_id?: UUID | null;

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

const MySentInvitesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const headerTitle = 'My Sent Invites';

  useEffect(() => { navigation.setOptions?.({ headerShown: false }); }, [navigation]);

  const [me, setMe] = useState<UUID | null>(null);
  const [rows, setRows] = useState<SentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyReqId, setBusyReqId] = useState<UUID | null>(null);

  // single realtime channel (lean)
  const chHostRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
        const seen = await AsyncStorage.getItem('hint_my_sent_invites_v11');
        if (!seen) await AsyncStorage.setItem('hint_my_sent_invites_v11', 'true');
      } catch {}
    })();
  }, []);

  /* ------------------------- helpers: fetchers ------------------------- */

  const fetchEventMap = useCallback(async (ids: UUID[]) => {
    const map = new Map<UUID, DateRow>();
    if (!ids.length) return map;

    const uniq = Array.from(new Set(ids));

    // 1) canonical: dates
    try {
      const { data: d1 } = await supabase.from('dates').select('*').in('id', uniq);
      (d1 || []).forEach((row: any) => map.set(row.id, row as DateRow));
    } catch {}

    // 2) fill gaps from date_requests by date_id
    const missing = uniq.filter((id) => !map.has(id));
    if (missing.length) {
      try {
        const { data: d2 } = await supabase.from('date_requests').select('*').in('date_id', missing);
        (d2 || []).forEach((row: any) => {
          const did = row?.date_id;
          if (did && (row.title || row.event_date || row.location || row.photo_urls || row.cover_image_url)) {
            if (!map.has(did)) map.set(did, row as DateRow);
          }
        });
      } catch {}
    }

    return map;
  }, []);

  /**
   * PROFILES: hydrate like ManageApplicants.
   * Minimal, schema-safe column list to avoid supabase select errors.
   */
  const fetchProfilesHydrated = useCallback(async (byProfileIds: UUID[], byAuthIds: UUID[]) => {
    const map = new Map<UUID, ProfileRow>();

    const PROFILE_COLS = 'id, screenname, profile_photo, location, gender, orientation, about, gallery_photos';

    const uniqProfile = Array.from(new Set(byProfileIds.filter(Boolean)));
    const uniqAuth    = Array.from(new Set(byAuthIds.filter(Boolean)));

    // Pass 1: by profiles.id
    if (uniqProfile.length) {
      try {
        const { data } = await supabase.from('profiles').select(PROFILE_COLS).in('id', uniqProfile);
        (data || []).forEach((row: any) => { map.set(row.id, row as ProfileRow); });
      } catch {}
    }

    // Pass 2: by common auth FK columns (map results by FK and by id)
    let needAuth = uniqAuth.filter((id) => !map.has(id));
    const authColumns = ['user_id', 'uid', 'auth_id', 'auth_user_id', 'account_id'] as const;

    for (const col of authColumns) {
      if (!needAuth.length) break;
      try {
        const { data } = await supabase.from('profiles').select(`${PROFILE_COLS}, ${col}`).in(col as any, needAuth);
        (data || []).forEach((row: any) => {
          if (row[col]) map.set(row[col] as UUID, row as ProfileRow);
          if (row.id)   map.set(row.id as UUID, row as ProfileRow);
        });
        needAuth = needAuth.filter((id) => !map.has(id));
      } catch {}
    }

    return map;
  }, []);

  const fetchAcceptedCounts = useCallback(async (ids: UUID[]) => {
    // Authoritative accepted count from date_requests
    const counts = new Map<UUID, number>();
    if (!ids.length) return counts;

    try {
      const { data } = await supabase
        .from('date_requests')
        .select('date_id')
        .eq('status', 'accepted')
        .in('date_id', ids);
      (data || []).forEach((r: any) => {
        counts.set(r.date_id, (counts.get(r.date_id) ?? 0) + 1);
      });
    } catch {}

    return counts;
  }, []);

  /* ------------------ detect + query (view first) ------------------ */

  const fetchSentCore = useCallback(async (_hostId: UUID): Promise<{ kind: 'view' | 'dr' | 'invites' | 'none'; pending: PendingCore[] }> => {
    // 1) v_sent_invites — already scoped by RLS/auth.uid()
    try {
      const { data, error } = await supabase
        .from('v_sent_invites')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length) {
        const pending = (data as any[])
          .map((r) => {
            const status = String(r.status ?? 'pending').toLowerCase();
            if (!SHOWABLE_STATUSES.has(status)) return null;
            const ids = extractRecipientIds(r);
            const req = readStr(r.req_id ?? r.dr_id ?? r.date_request_id ?? r.id); // view must expose DR id here
            const did = readStr(r.date_id ?? r.event_id ?? r.date);
            if (!req || !did || (!ids.profileId && !ids.authId)) return null;
            return {
              req_id: req,
              date_id: did,
              created_at: (r.created_at || new Date().toISOString()) as string,
              recipient_profile_id: ids.profileId ?? null,
              recipient_auth_id: ids.authId ?? null,
              _title: r.title ?? null,
              _event_date: r.event_date ?? null,
              _event_tz: r.event_timezone ?? null,
            } as PendingCore;
          })
          .filter(Boolean) as PendingCore[];

        if (pending.length) return { kind: 'view', pending };
      }
    } catch { /* fall through */ }

    // 2) authoritative fallback: date_requests (host's pending)
    try {
      const { data, error } = await supabase
        .from('date_requests')
        .select('id, date_id, created_at, recipient_id, title, event_date, event_timezone')
        .eq('requester_id', _hostId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length) {
        const pending = (data as any[])
          .map((r) => {
            const req = readStr(r.id);
            const did = readStr(r.date_id);
            if (!req || !did) return null;
            return {
              req_id: req,
              date_id: did,
              created_at: (r.created_at || new Date().toISOString()) as string,
              recipient_profile_id: readStr(r.recipient_id),
              recipient_auth_id: null,
              _title: r.title ?? null,
              _event_date: r.event_date ?? null,
              _event_tz: r.event_timezone ?? null,
            } as PendingCore;
          })
          .filter(Boolean) as PendingCore[];

        if (pending.length) return { kind: 'dr', pending };
      }
    } catch { /* fall through */ }

    // 3) legacy invites (for hydration only; rescind will still try to map to DR)
    try {
      const { data } = await supabase
        .from('invites')
        .select('*')
        .eq('inviter_id', _hostId)
        .order('created_at', { ascending: false });

      if (Array.isArray(data) && data.length) {
        const pending = (data as any[])
          .map((r) => {
            const status = String(r.status ?? 'pending').toLowerCase();
            if (!SHOWABLE_STATUSES.has(status)) return null;
            const ids = extractRecipientIds(r);
            const req = readStr(r.req_id ?? r.id); // this might NOT be the DR id; we'll resolve on rescind
            const did = readStr(r.date_id);
            if (!req || !did || (!ids.profileId && !ids.authId)) return null;
            return {
              req_id: req,
              date_id: did,
              created_at: (r.created_at || new Date().toISOString()) as string,
              recipient_profile_id: ids.profileId ?? null,
              recipient_auth_id: ids.authId ?? null,
            } as PendingCore;
          })
          .filter(Boolean) as PendingCore[];
        if (pending.length) return { kind: 'invites', pending };
      }
    } catch {}

    return { kind: 'none', pending: [] };
  }, []);

  /* ----------------------------- main fetch ---------------------------- */

  const detachChannel = useCallback(() => {
    try { chHostRef.current?.unsubscribe(); } catch {}
    chHostRef.current = null;
  }, []);

  const attachHostDateRequestsRealtime = useCallback((hostId: UUID) => {
    detachChannel();
    chHostRef.current = supabase
      .channel(`sent-invites:${hostId}`)
      // If a DR for me leaves pending → drop locally (fast)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'date_requests',
        filter: `requester_id=eq.${hostId}`
      }, payload => {
        const newStatus = String(payload.new?.status ?? '').toLowerCase();
        if (newStatus && newStatus !== 'pending') {
          setRows(curr => curr.filter(r => r.req_id !== payload.new.id));
        }
      })
      // If a DR is inserted for me in pending → refresh to hydrate joins
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'date_requests',
        filter: `requester_id=eq.${hostId}`
      }, () => { fetchRows(false); })
      // Deletions (rare) → remove
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'date_requests',
        filter: `requester_id=eq.${hostId}`
      }, payload => {
        setRows(curr => curr.filter(r => r.req_id !== payload.old.id));
      })
      .subscribe();
  }, [detachChannel]);

  const fetchRows = useCallback(async (showSpinner = true) => {
    if (!me) { setRows([]); setLoading(false); setRefreshing(false); return; }
    if (showSpinner && !refreshing) setLoading(true);

    let core: Awaited<ReturnType<typeof fetchSentCore>>;
    try { core = await fetchSentCore(me); } catch (e) {
      console.error('[MySentInvites] fetch core error', e);
      setRows([]); setLoading(false); setRefreshing(false);
      return;
    }

    const pending = core.pending;
    if (!pending.length) {
      setRows([]);
      setLoading(false); setRefreshing(false);
      attachHostDateRequestsRealtime(me);
      return;
    }

    const dateIds             = Array.from(new Set(pending.map((r) => r.date_id)));
    const recipientProfileIds = Array.from(new Set(pending.map((r) => r.recipient_profile_id).filter(Boolean))) as UUID[];
    const recipientAuthIds    = Array.from(new Set(pending.map((r) => r.recipient_auth_id).filter(Boolean))) as UUID[];

    const [eventMap, profileMap, acceptedCounts] = await Promise.all([
      fetchEventMap(dateIds),
      fetchProfilesHydrated(recipientProfileIds, recipientAuthIds),
      fetchAcceptedCounts(dateIds),
    ]);

    const cleaned: SentItem[] = pending.map((r) => {
      const p: ProfileRow | undefined =
        (r.recipient_profile_id ? profileMap.get(r.recipient_profile_id) : undefined) ||
        (r.recipient_auth_id ? profileMap.get(r.recipient_auth_id) : undefined);

      const gallery = toStringArray(p?.gallery_photos);
      const primaryPhoto = p?.profile_photo || (gallery.length ? gallery[0] : null);
      const collapsedOrientation = Array.isArray(p?.orientation)
        ? (p?.orientation[0] as string | undefined)
        : (p?.orientation as string | undefined);

      const user = {
        id: (p?.id as UUID) || (r.recipient_profile_id as UUID) || (r.recipient_auth_id as UUID),
        screenname: p?.screenname ?? 'Guest',
        profile_photo: primaryPhoto ?? null,
        location: p?.location ?? undefined,
        latitude: undefined,
        longitude: undefined,
        gender: p?.gender ?? null,
        orientation: collapsedOrientation ?? null,
        about: p?.about ?? null,
        gallery_photos: gallery,
      };

      const d = eventMap.get(r.date_id) as DateRow | undefined;

      // capacity/full calc
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

      // cover image for DateTag
      let datePhoto: string | null = null;
      if ((d as any)?.cover_image_url) datePhoto = String((d as any).cover_image_url);
      else if (Array.isArray(d?.photo_urls) && d!.photo_urls!.length) datePhoto = String(d!.photo_urls![0]);
      else if (d?.profile_photo) datePhoto = String(d.profile_photo);

      const cleanLoc =
        (d?.location && !looksLikeWKTOrHex(d.location) ? d.location : null) ||
        (d as any)?.location_str ||
        null;

      return {
        req_id: r.req_id,
        date_id: r.date_id,
        created_at: r.created_at,

        recipient_profile_id: r.recipient_profile_id ?? null,
        recipient_auth_id: r.recipient_auth_id ?? null,

        user,

        date_title: (d?.title ?? r._title ?? null) as string | null,
        event_date: (d?.event_date ?? r._event_date ?? null) as string | null,
        event_timezone: ((d as any)?.event_timezone ?? r._event_tz ?? null) as string | null,
        date_location: cleanLoc,
        date_photo_url: datePhoto,

        creator_id: ((d?.creator_id ?? d?.creator ?? d?.user_id ?? d?.uid) ?? null) as UUID | null,
        who_pays: (d?.who_pays ?? null) as string | null,
        event_type: (d?.event_type ?? null) as string | null,

        full,
        expired,
      } as SentItem;
    })
    .filter((it) => !it.full && !it.expired);

    cleaned.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    setRows(cleaned);
    setLoading(false);
    setRefreshing(false);

    // realtime watcher (single, lean)
    attachHostDateRequestsRealtime(me);
  }, [
    me,
    refreshing,
    fetchSentCore,
    fetchEventMap,
    fetchProfilesHydrated,
    fetchAcceptedCounts,
    attachHostDateRequestsRealtime,
  ]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRows();
  }, [fetchRows]);

  // first mount + focus refresh
  useEffect(() => {
    (async () => { await fetchRows(); })();
    return () => detachChannel();
  }, [fetchRows, detachChannel]);

  useFocusEffect(React.useCallback(() => {
    fetchRows();
    return () => {};
  }, [fetchRows]));

  // prune locally (handles crossing midnight in event TZ without server events)
  useEffect(() => {
    const t = setInterval(() => setRows((prev) =>
      prev.filter((r) => !r.full && !isPastLocalEndOfDay(r.event_date, r.event_timezone))
    ), 60_000);
    return () => clearInterval(t);
  }, []);

  /* -------------------------------- actions -------------------------------- */

  const resolveDateRequestIdIfNeeded = useCallback(async (row: SentItem): Promise<UUID | null> => {
    // If the req_id is already a DR id (typical via view/dr fallback), use it:
    if (row.req_id && row.req_id.length >= 8) return row.req_id;

    // Otherwise, find the matching DR row by (host, date_id, recipient)
    const candidates: UUID[] = [];
    if (row.recipient_profile_id) candidates.push(row.recipient_profile_id);
    if (row.user?.id && !candidates.includes(row.user.id)) candidates.push(row.user.id);

    try {
      const { data, error } = await supabase
        .from('date_requests')
        .select('id')
        .eq('requester_id', me!)
        .eq('date_id', row.date_id)
        .eq('status', 'pending')
        .in('recipient_id', candidates.length ? candidates : ['00000000-0000-0000-0000-000000000000'])
        .limit(1);
      if (error) return null;
      return Array.isArray(data) && data[0]?.id ? (data[0].id as UUID) : null;
    } catch {
      return null;
    }
  }, [me]);

  const onRescind = useCallback(async (row: SentItem) => {
    if (!me) return;
    if (busyReqId) return;
    setBusyReqId(row.req_id);

    // Optimistic remove from UI
    setRows(prev => prev.filter(r => r.req_id !== row.req_id));

    try {
      // 1) Try RPC with the req_id we have (typical)
      let { error } = await supabase.rpc('invites_decide', {
        p_req_id: row.req_id,
        p_decision: 'rescinded',
      });

      // 2) If that failed (e.g., legacy row), resolve DR id and try again
      if (error) {
        const resolved = await resolveDateRequestIdIfNeeded(row);
        if (!resolved) throw error;
        const { error: e2 } = await supabase.rpc('invites_decide', {
          p_req_id: resolved,
          p_decision: 'rescinded',
        });
        if (e2) throw e2;
      }

      // Fire-and-forget UX notification (optional)
      try {
        await notifyInviteRevoked({
          recipientId: String(row.recipient_profile_id || row.user.id),
          dateId: row.date_id,
          eventTitle: row.date_title ?? 'your invite',
        });
      } catch {}
    } catch (e: any) {
      // If RPC says not-pending, the other side already acted; keep it pruned.
      const msg = String(e?.message || '').toLowerCase();
      if (!msg.includes('not-pending')) {
        Alert.alert('Could not rescind', e?.message || 'Please try again.');
        // best effort re-sync
        await fetchRows(false);
      }
    } finally {
      setBusyReqId(null);
    }
  }, [me, busyReqId, resolveDateRequestIdIfNeeded, fetchRows]);

  /* ------------------------------ guarded UI ------------------------------- */

  if (loading) {
    return (
      <AppShell headerTitle={headerTitle} showBack currentTab="My DrYnks">
        <View style={styles.centered}><ActivityIndicator /></View>
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell headerTitle={headerTitle} showBack currentTab="My DrYnks">
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
      <AppShell headerTitle={headerTitle} showBack currentTab="My DrYnks">
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No sent invites yet.</Text>
          <Text style={styles.emptySub}>Invite friends from your date card, or browse dates to get started.</Text>
          <View style={styles.emptyCtasRow}>
            <TouchableOpacity onPress={() => { try { navigation.navigate('MyDates' as never); } catch { try { navigation.navigate('My DrYnks' as never); } catch {} } }} style={[styles.ctaBtn, { backgroundColor: DRYNKS_BLUE }]}>
              <Text style={styles.ctaBtnText}>My Dates</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { try { navigation.navigate('DateFeed' as never); } catch {} }} style={[styles.ctaBtn, { backgroundColor: DRYNKS_RED }]}>
              <Text style={styles.ctaBtnText}>Browse Dates</Text>
            </TouchableOpacity>
          </View>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell headerTitle={headerTitle} showBack currentTab="My DrYnks">
      <FlatList
        data={rows}
        keyExtractor={(it) => it.req_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24, paddingTop: 4 }}
        ListHeaderComponent={
          <View style={styles.instructions}>
            <Text style={styles.instructionsText}>
              Tap <Text style={{ fontWeight: '800' }}>Rescind</Text> on a card to cancel that invite
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        initialNumToRender={6}
        windowSize={10}
        removeClippedSubviews
        renderItem={({ item }) => {
          const disabled = item.expired || item.full;
          return (
            <View style={styles.rowWrap}>
              <View style={styles.cardWrap}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <DateTag
                      title={item.date_title}
                      event_date={item.event_date}
                      tz={item.event_timezone}
                      location={item.date_location}
                      photo={item.date_photo_url}
                      disabled={disabled}
                    />
                  </View>
                  <RescindButton onPress={() => onRescind(item)} disabled={busyReqId === item.req_id} />
                </View>

                <ProfileCard
                  user={item.user}
                  compact
                  origin="MySentInvites"
                  invited
                  onInvite={() => {}}
                  onPressProfile={() => { try { navigation.navigate('PublicProfile' as never, { userId: item.user.id, origin: 'MySentInvites' } as never); } catch {} }}
                  onNamePress={() => { try { navigation.navigate('PublicProfile' as never, { userId: item.user.id, origin: 'MySentInvites' } as never); } catch {} }}
                  onAvatarPress={() => { try { navigation.navigate('PublicProfile' as never, { userId: item.user.id, origin: 'MySentInvites' } as never); } catch {} }}
                />
              </View>
            </View>
          );
        }}
      />
    </AppShell>
  );
};

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  emptyText: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
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

  rescindBtn: {
    marginRight: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#DCFCE7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rescindText: { color: '#166534', fontSize: 12, fontWeight: '700' },
});

export default MySentInvitesScreen;
