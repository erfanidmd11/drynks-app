// Invite Nearby — production ready (DrYnks)
// Fixes FK errors + keeps card rendering:
// - Compute/ensure a canonical `dates.id` from routed dateId (which may be a date_requests.id)
// - Insert to `invites` using the canonical dates.id (FK-safe)
// - Optionally mirror to date_requests join when FK-safe
// - FlatList re-render via extraData
// - Realtime on invites (and date_requests join when FK-safe)
// - RPC + local fallback for nearby users unchanged

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
  Alert,
  ScrollView,
  Image,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@config/supabase';
import ProfileCard from '@components/cards/ProfileCard';
import ProfileCardSkeleton from '@components/cards/ProfileCardSkeleton';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const { width } = Dimensions.get('window');

const PAGE_SIZE = 10;
const DISTANCE_OPTIONS_MI = [25, 50, 100, 150, 200, 250, 450, 10000];
const USE_RPC = true;

/* ------------------------ tiny diagnostics helpers ------------------------ */
const stringifyError = (e: unknown) =>
  typeof e === 'string' ? e : JSON.stringify(e, Object.getOwnPropertyNames(e as object), 2);
const firstLines = (s: string, n = 25) => s.split('\n').slice(0, n).join('\n');

/* --------------------------------- types --------------------------------- */
type NearbyParams = {
  eventLocation?: { latitude?: number; longitude?: number } | null;
  latitude?: number | null;
  longitude?: number | null;
  genderPrefs?: Record<string, string | number> | null;
  orientationPref?: string[] | null;
  // Your navigator currently passes a date_requests.id here
  dateId?: string | null;
};

type CardUser = {
  id: string;
  screenname: string;
  profile_photo?: string | null;
  location?: string;
  latitude: number;
  longitude: number;
  gender?: string | null;
  orientation?: string | null;
  about?: string | null;
  gallery_photos?: string[];
  distance_km?: number;
};

/* ------------------------------ small utils ------------------------------ */
const milesToKm = (mi: number) => mi * 1.60934;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const asNumber = (v: any): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

const normalizeGenderKeys = (obj?: Record<string, any> | null) => {
  if (!obj) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key =
      String(k).toLowerCase() === 'female' ? 'Female' :
      String(k).toLowerCase() === 'male'   ? 'Male'   :
      String(k).toLowerCase() === 'ts'     ? 'TS'     : String(k);
    out[key] = Number(v ?? 0);
  }
  return out;
};

const sumCounts = (o?: Record<string, number> | null) =>
  Object.values(o ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

const mapToProfileCardUser = (row: any): CardUser => ({
  id: String(row.id),
  screenname: row.screenname ?? row.username ?? 'Guest',
  profile_photo: row.profile_photo ?? row.primary_photo ?? null,
  location: row.location ?? '',
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  gender: row.gender ?? null,
  orientation: Array.isArray(row.orientation) ? (row.orientation[0] ?? null) : (row.orientation ?? null),
  about: row.about ?? row.bio ?? '',
  gallery_photos: Array.isArray(row.gallery_photos) ? row.gallery_photos : (row.gallery_photos ?? []),
  distance_km: typeof row.distance_km === 'number' ? row.distance_km : undefined,
});

// Parse Postgres text[] or JSON array or odd quoted-hybrid literals safely
const parsePgTextArrayLiteral = (lit: string): string[] => {
  const s0 = String(lit || '').trim();
  const s = s0.startsWith('"') && s0.endsWith('"') ? s0.slice(1, -1) : s0; // strip outer quotes if present
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1);
    const out: string[] = [];
    let buf = '';
    let inQuotes = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') {
        if (inQuotes && inner[i + 1] === '"') { buf += '"'; i++; }
        else { inQuotes = !inQuotes; }
        continue;
      }
      if (ch === ',' && !inQuotes) { out.push(buf); buf = ''; continue; }
      buf += ch;
    }
    out.push(buf);
    return out.map(x => x.trim()).filter(Boolean);
  }
  return [];
};

const parsePhotoUrls = (v: any): string[] => {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v !== 'string' || v.trim().length === 0) return [];
  const s0 = v.trim();
  const s = s0.startsWith('"') && s0.endsWith('"') ? s0.slice(1, -1) : s0;
  if (s.trim().startsWith('[')) {
    try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr.map(String) : []; } catch { /* ignore */ }
  }
  if (s.trim().startsWith('{')) {
    return parsePgTextArrayLiteral(s);
  }
  // Fallback: extract URLs from any string
  const urls = Array.from(s.matchAll(/https?:\/\/[^\s"'}\]]+/g)).map(m => m[0]);
  return urls;
};

/* ------------------------------- component ------------------------------- */
const InviteNearbyScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute() as any;

  const {
    eventLocation: paramLoc,
    latitude: latParam,
    longitude: lngParam,
    genderPrefs: paramGenderPrefs,
    orientationPref: paramOrientation,
    dateId: routedDateId,
  }: NearbyParams = route.params || {};

  // Navigator supplied id (today: date_requests.id)
  const [dateId, setDateId] = useState<string | null>(routedDateId ?? null);

  // FK-safe id for invites (guaranteed dates.id)
  const [fkDateId, setFkDateId] = useState<string | null>(null);

  // Event coords for nearby users (from either table)
  const [eventLat, setEventLat] = useState<number | null>(
    asNumber(paramLoc?.latitude) ?? asNumber(latParam)
  );
  const [eventLng, setEventLng] = useState<number | null>(
    asNumber(paramLoc?.longitude) ?? asNumber(lngParam)
  );

  const [genderPrefs, setGenderPrefs] = useState<Record<string, number>>(
    normalizeGenderKeys(paramGenderPrefs as any)
  );
  const [orientationPref, setOrientationPref] = useState<string[] | null>(
    Array.isArray(paramOrientation) ? paramOrientation : null
  );

  /* ----------------------- ensure FK-safe dates.id ----------------------- */
  // Create a minimal `dates` row from a date_requests row (only columns that exist in `dates`)
  const createDatesRowFromDR = useCallback(
    async (dr: any, uid: string): Promise<string> => {
      const photo_urls = parsePhotoUrls(dr?.photo_urls);
      const coverFromPhotos = photo_urls.length ? String(photo_urls[0]) : null;
      const profilePhoto = dr?.profile_photo || null;

      const preferred =
        typeof dr?.preferred_gender_counts === 'string'
          ? (() => { try { return JSON.parse(dr.preferred_gender_counts); } catch { return null; } })()
          : dr?.preferred_gender_counts || null;

      const remaining =
        typeof dr?.remaining_gender_counts === 'string'
          ? (() => { try { return JSON.parse(dr.remaining_gender_counts); } catch { return null; } })()
          : dr?.remaining_gender_counts || null;

      const base: Record<string, any> = {
        title: dr?.title || 'DrYnks Date',
        event_date: dr?.event_date || new Date().toISOString(),
        event_timezone: dr?.event_timezone || 'UTC',
        who_pays: dr?.who_pays ?? null,
        preferred_gender_counts: preferred,
        remaining_gender_counts: remaining,
        spots: typeof dr?.spots === 'number'
          ? dr.spots
          : Math.max(1, (sumCounts(preferred) || 0) + 1),
        location: dr?.location ?? dr?.location_str ?? null,
        profile_photo: profilePhoto ?? coverFromPhotos,
        photo_urls: photo_urls,
        latitude: dr?.latitude ?? null,
        longitude: dr?.longitude ?? null,
        status: 'active',
        creator: uid, // dates.creator -> auth.users.id
      };

      const { data, error } = await supabase
        .from('dates')
        .insert([base])
        .select('id')
        .single();

      if (error) throw error;
      if (!data?.id) throw new Error('No id returned from dates insert');

      // Best-effort: link back so future screens already have date_requests.date_id
      try {
        if (dr?.id) {
          await supabase.from('date_requests').update({ date_id: data.id }).eq('id', dr.id);
        }
      } catch {
        // ignore—RLS may disallow, not required for invite flow
      }

      return data.id;
    },
    []
  );

  // Return a FK-safe dates.id for invites.
  const ensureFKDateId = useCallback(
    async (rawId: string | null, uid: string | null): Promise<string | null> => {
      if (!rawId) return null;
      if (fkDateId) return fkDateId;

      // 1) rawId already a `dates.id`?
      try {
        const { data: d } = await supabase.from('dates').select('id').eq('id', rawId).maybeSingle();
        if (d?.id) {
          setFkDateId(d.id);
          return d.id;
        }
      } catch {
        /* ignore — RLS could block this check */
      }

      // 2) Treat rawId as date_requests.id and read the row
      let dr: any = null;
      try {
        const { data } = await supabase
          .from('date_requests')
          .select(
            [
              'id', 'date_id',
              'title', 'event_date', 'event_timezone',
              'who_pays',
              'preferred_gender_counts', 'remaining_gender_counts',
              'latitude', 'longitude',
              'location', 'location_str',
              'profile_photo',
              'photo_urls',
              'spots',
            ].join(', ')
          )
          .eq('id', rawId)
          .maybeSingle();
        dr = data || null;

        // If the join is already set, **use it directly** (do NOT re-verify against `dates` to avoid RLS false negatives)
        if (dr?.date_id) {
          setFkDateId(dr.date_id);
          return dr.date_id;
        }
      } catch {
        // ignore; we'll try to create below
      }

      // 3) No join yet — create a minimal `dates` record and return its id
      if (dr && uid) {
        try {
          const newId = await createDatesRowFromDR(dr, uid);
          setFkDateId(newId);
          return newId;
        } catch (e) {
          console.error('[InviteNearby] ensureFKDateId create dates failed:\n', firstLines(stringifyError(e), 40));
          return null;
        }
      }

      // 4) Give up
      return null;
    },
    [createDatesRowFromDR, fkDateId]
  );

  /* ------------------------------ bootstrap ------------------------------ */
  const [loggedInUser, setLoggedInUser] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error && __DEV__) console.warn('[InviteNearby] auth.getUser error:', error.message);
      setLoggedInUser(data?.user ?? null);
    })();
  }, []);

  // Proactively resolve a canonical dates.id early (so invite is smooth)
  useEffect(() => {
    (async () => {
      if (loggedInUser?.id && dateId && !fkDateId) {
        try {
          const canonical = await ensureFKDateId(dateId, loggedInUser.id);
          if (canonical) {
            setFkDateId(canonical);
            // migrate optimistic cache to canonical key
            const oldKey = `invited_${dateId}`;
            const newKey = `invited_${canonical}`;
            try {
              const raw = await AsyncStorage.getItem(oldKey);
              if (raw) await AsyncStorage.setItem(newKey, raw);
            } catch {}
          }
        } catch {}
      }
    })();
  }, [loggedInUser?.id, dateId, fkDateId, ensureFKDateId]);

  // Pull missing coords/filters from event rows (date_requests preferred, then dates)
  useEffect(() => {
    (async () => {
      const idToFetch = dateId ?? routedDateId ?? null;
      if (!idToFetch) return;

      const needCoords = eventLat == null || eventLng == null;
      const needFilters = !orientationPref || !Object.keys(genderPrefs).length;

      if (!needCoords && !needFilters) return;

      // Prefer date_requests (your current source of truth)
      try {
        const { data: dr } = await supabase
          .from('date_requests')
          .select('id, latitude, longitude, preferred_gender_counts, orientation_preference')
          .eq('id', idToFetch)
          .maybeSingle();

        if (dr) {
          setDateId(dr.id);
          if (needCoords) {
            const lat = asNumber((dr as any)?.latitude);
            const lng = asNumber((dr as any)?.longitude);
            if (lat != null) setEventLat(lat);
            if (lng != null) setEventLng(lng);
          }
          if (!Object.keys(genderPrefs).length) {
            try {
              const pgc = typeof (dr as any)?.preferred_gender_counts === 'string'
                ? JSON.parse((dr as any)?.preferred_gender_counts)
                : (dr as any)?.preferred_gender_counts;
              const normalized = normalizeGenderKeys(pgc);
              if (Object.keys(normalized).length) setGenderPrefs(normalized);
            } catch {}
          }
          if (!orientationPref) {
            const arr = Array.isArray((dr as any)?.orientation_preference) && (dr as any)?.orientation_preference.length
              ? (dr as any)?.orientation_preference : ['Everyone'];
            setOrientationPref(arr);
          }
          return;
        }
      } catch {}

      // Fallback: dates
      try {
        const { data: d2 } = await supabase
          .from('dates')
          .select('id, latitude, longitude, preferred_gender_counts')
          .eq('id', idToFetch)
          .maybeSingle();

        if (d2) {
          setDateId(d2.id);
          if (needCoords) {
            const lat = asNumber((d2 as any)?.latitude);
            const lng = asNumber((d2 as any)?.longitude);
            if (lat != null) setEventLat(lat);
            if (lng != null) setEventLng(lng);
          }
          if (!Object.keys(genderPrefs).length) {
            try {
              const pgc = typeof (d2 as any)?.preferred_gender_counts === 'string'
                ? JSON.parse((d2 as any)?.preferred_gender_counts)
                : (d2 as any)?.preferred_gender_counts;
              const normalized = normalizeGenderKeys(pgc);
              if (Object.keys(normalized).length) setGenderPrefs(normalized);
            } catch {}
          }
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateId, routedDateId, eventLat, eventLng]);

  /* ---------------------- invited-cache + realtime ----------------------- */
  const [users, setUsers] = useState<CardUser[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [radiusKm, setRadiusKm] = useState<number>(402.336);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const effectiveEventId = fkDateId || dateId || 'no_date';
  const invitedKey = useMemo(() => `invited_${effectiveEventId}`, [effectiveEventId]);
  const [invitedUserIds, setInvitedUserIds] = useState<Set<string>>(new Set());

  // Realtime
  const chInvitesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chDateReqJoinRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const detachRealtime = useCallback(() => {
    try { chInvitesRef.current?.unsubscribe(); } catch {}
    try { chDateReqJoinRef.current?.unsubscribe(); } catch {}
    chInvitesRef.current = null;
    chDateReqJoinRef.current = null;
  }, []);

  const attachRealtime = useCallback(async (viewerId: string, invitesId: string) => {
    detachRealtime();

    // Invites (always use the FK-safe id if available)
    chInvitesRef.current = supabase
      .channel(`invite_nearby_invites_${invitesId}_${viewerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invites', filter: `date_id=eq.${invitesId}` },
        (payload: any) => {
          const row = (payload.new ?? payload.old) as any;
          if (!row || row.inviter_id !== viewerId) return;
          const rec = row.invitee_id as string | undefined;

          setInvitedUserIds(prev => {
            const next = new Set(prev);
            const status = (payload.new?.status ?? payload.old?.status) as string | undefined;
            if (payload.eventType === 'DELETE' || (status && status !== 'pending')) {
              if (rec) next.delete(rec);
            } else if (status === 'pending') {
              if (rec) next.add(rec);
            }
            if (next.size !== prev.size) {
              AsyncStorage.setItem(invitedKey, JSON.stringify(Array.from(next))).catch(() => {});
            }
            return next;
          });
        }
      )
      .subscribe(() => {});

    // date_requests join (only when invitesId is a real dates.id)
    try {
      const { data: existsDates } = await supabase
        .from('dates')
        .select('id')
        .eq('id', invitesId)
        .limit(1)
        .maybeSingle();
      if (existsDates?.id) {
        chDateReqJoinRef.current = supabase
          .channel(`invite_nearby_drjoin_${invitesId}_${viewerId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'date_requests', filter: `date_id=eq.${invitesId}` },
            (payload: any) => {
              const row = (payload.new ?? payload.old) as any;
              if (!row || row.requester_id !== viewerId) return;
              const rec = row.recipient_id as string | undefined;

              setInvitedUserIds(prev => {
                const next = new Set(prev);
                const status = (payload.new?.status ?? payload.old?.status) as string | undefined;
                if (payload.eventType === 'DELETE' || (status && status !== 'pending')) {
                  if (rec) next.delete(rec);
                } else if (status === 'pending') {
                  if (rec) next.add(rec);
                }
                if (next.size !== prev.size) {
                  AsyncStorage.setItem(invitedKey, JSON.stringify(Array.from(next))).catch(() => {});
                }
                return next;
              });
            }
          )
          .subscribe(() => {});
      }
    } catch {}
  }, [detachRealtime, invitedKey]);

  useEffect(() => {
    if (loggedInUser?.id && (fkDateId || dateId)) {
      attachRealtime(loggedInUser.id, fkDateId || dateId!);
      return () => detachRealtime();
    }
  }, [attachRealtime, detachRealtime, loggedInUser?.id, fkDateId, dateId]);

  // invited cache -> load
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(invitedKey);
        if (raw) setInvitedUserIds(new Set(JSON.parse(raw) as string[]));
        else setInvitedUserIds(new Set());
      } catch {
        setInvitedUserIds(new Set());
      }
    })();
  }, [invitedKey]);

  // Seed invited from DB
  const seedInvitedFromDB = useCallback(async () => {
    if (!loggedInUser?.id || !(fkDateId || dateId)) return;

    const eventForInvites = fkDateId || dateId!;
    try {
      const [{ data: inv }, { data: dr }] = await Promise.all([
        supabase
          .from('invites')
          .select('invitee_id,status')
          .eq('date_id', eventForInvites)
          .eq('inviter_id', loggedInUser.id)
          .eq('status', 'pending'),
        supabase
          .from('date_requests')
          .select('recipient_id,status')
          .eq('date_id', eventForInvites)
          .eq('requester_id', loggedInUser.id)
          .eq('status', 'pending'),
      ]);

      const ids = new Set<string>();
      (inv || []).forEach((r: any) => r?.invitee_id && ids.add(String(r.invitee_id)));
      (dr || []).forEach((r: any) => r?.recipient_id && ids.add(String(r.recipient_id)));

      setInvitedUserIds(ids);
      AsyncStorage.setItem(invitedKey, JSON.stringify(Array.from(ids))).catch(() => {});
    } catch (err) {
      if (__DEV__) console.warn('[InviteNearby] seedInvitedFromDB failed', err);
    }
  }, [loggedInUser?.id, fkDateId, dateId, invitedKey]);

  useEffect(() => { seedInvitedFromDB(); }, [seedInvitedFromDB]);

  /* ------------------------------ fetching users ------------------------------ */
  const normOrientation = useMemo<string[]>(
    () => (Array.isArray(orientationPref) && orientationPref.length > 0 ? orientationPref : ['Everyone']),
    [orientationPref]
  );
  const selectedGenders = useMemo(
    () => Object.keys(genderPrefs || {}).filter((k) => Number((genderPrefs as any)[k] ?? 0) > 0),
    [genderPrefs]
  );

  const runFallbackQuery = useCallback(
    async (pageNumber: number, replace = false) => {
      if (eventLat == null || eventLng == null || !loggedInUser?.id) return;
      const { data: all, error: qErr } = await supabase
        .from('profiles')
        .select(
          'id, screenname, profile_photo, location, latitude, longitude, gender, orientation, about, gallery_photos'
        )
        .neq('id', loggedInUser.id)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(600);
      if (qErr) throw qErr;

      const filtered = (all || []).filter((p: any) => {
        if (selectedGenders.length && (!p.gender || !selectedGenders.includes(p.gender))) return false;

        const oPref = normOrientation;
        const everyone = oPref.includes('Everyone');
        const pOrient = p.orientation;
        if (!everyone && Array.isArray(oPref) && oPref.length > 0) {
          if (Array.isArray(pOrient)) {
            const hasOverlap = pOrient.some((o: string) => oPref.includes(o));
            if (!hasOverlap) return false;
          } else if (typeof pOrient === 'string' && pOrient.length > 0) {
            if (!oPref.includes(pOrient)) return false;
          }
        }

        const d = haversineKm(eventLat, eventLng, p.latitude, p.longitude);
        return d <= radiusKm;
      });

      filtered.sort((a: any, b: any) => {
        const da = haversineKm(eventLat, eventLng, a.latitude, a.longitude);
        const db = haversineKm(eventLat, eventLng, b.latitude, b.longitude);
        return da - db;
      });

      const start = pageNumber * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const slice = filtered.slice(start, end);
      const normalizedSlice: CardUser[] = slice.map(mapToProfileCardUser);

      if (normalizedSlice.length < PAGE_SIZE || end >= filtered.length) setHasMore(false);
      setUsers((prev) => (replace ? normalizedSlice : [...prev, ...normalizedSlice]));
      setPage(pageNumber);
    },
    [eventLat, eventLng, loggedInUser?.id, normOrientation, radiusKm, selectedGenders]
  );

  const fetchUsersNearby = useCallback(
    async (pageNumber: number, replace = false) => {
      if (!loggedInUser || eventLat == null || eventLng == null) return;

      try {
        setLoading(true);

        if (USE_RPC) {
          try {
            const params = {
              lat: eventLat,
              lng: eventLng,
              radius_km: radiusKm,
              user_id: loggedInUser.id,
              // Prefer canonical id when available
              date_id: fkDateId || dateId || '00000000-0000-0000-0000-000000000000',
              range_start: pageNumber * PAGE_SIZE,
              range_end: (pageNumber + 1) * PAGE_SIZE - 1,
              orientation_prefs: normOrientation,
              gender_prefs: selectedGenders,
            };

            const { data, error } = await supabase.rpc('get_users_nearby_event', params);
            if (error) throw error;

            const rows = Array.isArray(data) ? data : [];
            if (rows.length === 0 && pageNumber === 0) {
              await runFallbackQuery(pageNumber, replace);
              setLoading(false);
              return;
            }

            const normalized: CardUser[] = rows.map(mapToProfileCardUser);
            if (normalized.length < PAGE_SIZE) setHasMore(false);
            setUsers((prev) => (replace ? normalized : [...prev, ...normalized]));
            setPage(pageNumber);
            setLoading(false);
            return;
          } catch (rpcErr) {
            if (__DEV__) console.warn('[InviteNearby] RPC failed, fallback:', rpcErr);
          }
        }

        await runFallbackQuery(pageNumber, replace);
      } catch (err) {
        console.error('[InviteNearby] fetch error:', err);
        Alert.alert('Error', 'Could not load nearby users right now.');
      } finally {
        setLoading(false);
      }
    },
    [loggedInUser, eventLat, eventLng, radiusKm, fkDateId, dateId, normOrientation, selectedGenders, runFallbackQuery]
  );

  // Trigger loads
  useEffect(() => {
    if (!loggedInUser) return;
    if (eventLat == null || eventLng == null) return;
    setUsers([]);
    setHasMore(true);
    setPage(0);
    fetchUsersNearby(0, true);
  }, [
    loggedInUser,
    radiusKm,
    eventLat,
    eventLng,
    normOrientation.join('|'),
    selectedGenders.join('|'),
    fkDateId,
    dateId,
    fetchUsersNearby,
  ]);

  const handleLoadMore = () => { if (!loading && hasMore) fetchUsersNearby(page + 1); };

  /* --------------------------------- invite -------------------------------- */
  const insertNotification = useCallback(
    async (base: { user_id: string; type: string; title: string; body?: string | null; data?: Record<string, any> | null }) => {
      const { error: e1 } = await supabase.from('notifications').insert([base]);
      if (!e1) return true;

      const msg = String(e1?.message || '').toLowerCase();
      if (!msg.includes('type') && !msg.includes('schema cache')) throw e1;

      const { error: e2 } = await supabase.from('notifications').insert([
        { user_id: base.user_id, event_type: base.type, title: base.title, body: base.body ?? null, data: base.data ?? null },
      ]);
      if (!e2) return true;

      const { error: e3 } = await supabase.from('notifications').insert([
        { user_id: base.user_id, title: base.title, body: base.body ?? null, data: { ...(base.data || {}), kind: base.type } },
      ]);
      if (!e3) return true;

      throw e3;
    },
    []
  );

  const ensureLegacyInvitePending = useCallback(
    async (date_id: string, inviter_id: string, invitee_id: string) => {
      // Upsert-ish behavior
      const { data: exist, error } = await supabase
        .from('invites')
        .select('id,status')
        .eq('date_id', date_id)
        .eq('inviter_id', inviter_id)
        .eq('invitee_id', invitee_id)
        .limit(1);
      if (error) throw error;

      if (exist && exist.length) {
        const curr = exist[0];
        if (curr.status !== 'pending') {
          const { error: updErr } = await supabase.from('invites').update({ status: 'pending' }).eq('id', curr.id);
          if (updErr) throw updErr;
        }
        return true;
      }

      const { error: insErr } = await supabase
        .from('invites')
        .insert([{ date_id, inviter_id, invitee_id, status: 'pending' }]);
      if (insErr && insErr.code !== '23505') throw insErr;

      return true;
    },
    []
  );

  const ensureDateRequestPendingIfFKSafe = useCallback(
    async (date_id: string, requester_id: string, recipient_id: string) => {
      try {
        const { data: existsDates } = await supabase.from('dates').select('id').eq('id', date_id).limit(1).maybeSingle();
        if (!existsDates?.id) return false;

        const { data: exist, error } = await supabase
          .from('date_requests')
          .select('id,status')
          .eq('date_id', date_id)
          .eq('requester_id', requester_id)
          .eq('recipient_id', recipient_id)
          .limit(1);
        if (error) throw error;

        if (exist && exist.length) {
          const curr = exist[0];
          if (curr.status !== 'pending') {
            const { error: updErr } = await supabase.from('date_requests').update({ status: 'pending' }).eq('id', curr.id);
            if (updErr) throw updErr;
          }
          return true;
        }

        const { error: insErr } = await supabase
          .from('date_requests')
          .insert([{ date_id, requester_id, recipient_id, status: 'pending' }]);
        if (insErr && insErr.code !== '23505') throw insErr;

        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const inviteUser = useCallback(
    async (recipientId: string, recipientScreenname?: string) => {
      if (!loggedInUser) return;
      if (!dateId) {
        Alert.alert('No event selected', 'Please open Invite Nearby from your date to send invites.');
        return;
      }
      if (invitedUserIds.has(recipientId)) return;

      // Optimistic disable
      setInvitedUserIds(prev => {
        const next = new Set(prev);
        next.add(recipientId);
        AsyncStorage.setItem(invitedKey, JSON.stringify(Array.from(next))).catch(() => {});
        return next;
      });

      try {
        // Ensure we have a FK-safe `dates.id`
        let canonical = fkDateId;
        if (!canonical) canonical = await ensureFKDateId(dateId, loggedInUser.id);

        // If we still couldn't resolve, try *once* with the routed id and let the DB tell us
        if (!canonical) {
          try {
            await ensureLegacyInvitePending(dateId, loggedInUser.id, recipientId);
            canonical = dateId;
          } catch (preErr: any) {
            if (preErr?.code === '23503') {
              throw new Error('This event needs a backing record. Please open the date again and try.');
            }
            throw preErr;
          }
        }

        // 1) legacy invites (FK-safe)
        await ensureLegacyInvitePending(canonical!, loggedInUser.id, recipientId);

        // 2) optional: requests-join (only when FK-safe)
        await ensureDateRequestPendingIfFKSafe(canonical!, loggedInUser.id, recipientId);

        // Notify (non-blocking)
        try {
          await insertNotification({
            user_id: recipientId,
            type: 'invite',
            title: 'You have a DrYnks invite 🍸',
            body: 'Open the app to respond.',
            data: { action: 'invite_inapp', date_id: canonical, inviter_id: loggedInUser.id },
          });
        } catch {}

        // If we just discovered canonical id, re-seed realtime/keys
        if (!fkDateId && canonical) {
          setFkDateId(canonical);
          try {
            const raw = await AsyncStorage.getItem(invitedKey);
            if (raw) await AsyncStorage.setItem(`invited_${canonical}`, raw);
          } catch {}
        }

        Alert.alert('Invite sent', recipientScreenname || 'Guest');
      } catch (err: any) {
        // Roll back optimistic flag
        setInvitedUserIds(prev => {
          const next = new Set(prev);
          next.delete(recipientId);
          AsyncStorage.setItem(invitedKey, JSON.stringify(Array.from(next))).catch(() => {});
          return next;
        });

        console.error('inviteUser error:', firstLines(stringifyError(err), 40));
        const msg =
          err?.code === '23503'
            ? 'This event needs a backing record. Please try again.'
            : (err?.message || 'Please try again.');
        Alert.alert('Invite failed', msg);
      }
    },
    [
      loggedInUser,
      invitedUserIds,
      invitedKey,
      dateId,
      fkDateId,
      ensureFKDateId,
      ensureLegacyInvitePending,
      ensureDateRequestPendingIfFKSafe,
      insertNotification,
    ]
  );

  /* -------------------------------- render -------------------------------- */
  const renderItem = ({ item }: { item: CardUser }) => {
    const uid = String(item.id);
    const alreadyInvited = invitedUserIds.has(uid);

    const openProfileFromInvite = (userId: string) => {
      const params = {
        userId,
        origin: 'InviteNearby',
        preferHeader: true,
        dateId: fkDateId || dateId || null,
        afterInviteRoute: { tab: 'App', screen: 'My DrYnks', inner: 'MyDates' },
        returnTo: { name: 'InviteNearby', params: { dateId } },
      };
      try { navigation.navigate('ProfileDetails' as never, params as never); return; } catch {}
      try { navigation.navigate('ProfileDetailsScreen' as never, params as never); return; } catch {}
      try { navigation.navigate('Profile' as never, params as never); return; } catch {}
      const url = `dr-ynks://profile/${encodeURIComponent(userId)}?origin=InviteNearby`;
      Linking.openURL(url).catch(() => {});
    };

    return (
      <View style={viewMode === 'grid' ? styles.gridCard : styles.card}>
        <ProfileCard
          user={item}
          compact={viewMode === 'grid'}
          origin="InviteNearby"
          invited={alreadyInvited}
          onInvite={() => inviteUser(uid, item.screenname)}
          onPressProfile={() => openProfileFromInvite(uid)}
          onNamePress={() => openProfileFromInvite(uid)}
          onAvatarPress={() => openProfileFromInvite(uid)}
        />
      </View>
    );
  };

  const headerPaddingTop = Math.max(insets.top, 8);
  const bottomStackPadding = 52 /*Done*/ + 12 + 52 /*Invite*/ + 16 + insets.bottom;

  const handleShareInvite = async () => {
    try {
      const url = 'https://drnksapp.com/invite';
      await Clipboard.setStringAsync(url);
      await Linking.openURL(`sms:&body=${encodeURIComponent(`Join me on DrYnks: ${url}`)}`);
      Alert.alert('Invite Copied', 'You can paste it anywhere or send directly via text.');
    } catch {
      Alert.alert('Invite', 'Could not open Messages. The invite link is copied.');
    }
  };

  const goToMyDatesTab = useCallback(() => {
    try { navigation.navigate('App', { screen: 'My DrYnks' }); return; } catch {}
    const parent = navigation.getParent?.();
    if (parent) {
      try { parent.navigate('My DrYnks'); return; } catch {}
      try { parent.navigate('MyDates'); return; } catch {}
      try { parent.navigate('Dates'); return; } catch {}
    }
    navigation.reset({ index: 0, routes: [{ name: 'App', params: { screen: 'My DrYnks' } } as any] });
  }, [navigation]);

  const isSelectedMiles = (mi: number) =>
    mi === 10000 ? radiusKm >= 9999 : Math.abs(radiusKm - milesToKm(mi)) < 0.5;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
        <Image source={require('../../../assets/images/DrYnks_Y_logo.png')} style={styles.logo} />
        <TouchableOpacity onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}>
          <Text style={styles.toggle}>{viewMode === 'list' ? 'Grid View' : 'Full View'}</Text>
        </TouchableOpacity>
      </View>

      {/* Distance chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.radiusBar}
        contentContainerStyle={{ paddingRight: 12, alignItems: 'center' }}
      >
        {DISTANCE_OPTIONS_MI.map((mi) => {
          const selected = isSelectedMiles(mi);
          const label = mi === 10000 ? 'Nationwide' : `${mi} mi`;
          return (
            <TouchableOpacity
              key={mi}
              onPress={() => {
                if (!selected) {
                  setUsers([]);
                  setHasMore(true);
                  setPage(0);
                  setRadiusKm(mi === 10000 ? 10000 : milesToKm(mi));
                }
              }}
              style={[styles.radiusChip, selected && styles.radiusChipSelected]}
              activeOpacity={0.85}
            >
              <Text style={[styles.radiusChipText, selected && styles.radiusChipTextSelected]} numberOfLines={1}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      {loading && users.length === 0 ? (
        <View style={{ padding: 16 }}>
          {[...Array(3)].map((_, i) => (<ProfileCardSkeleton key={i} />))}
        </View>
      ) : users.length === 0 ? (
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: bottomStackPadding }}>
          <View style={{ backgroundColor: '#fefefe', borderRadius: 12, padding: 16 }}>
            <Text style={{ textAlign: 'center', fontSize: 16, fontWeight: '600', color: DRYNKS_BLUE, marginBottom: 10 }}>
              You’re a DrYnks Pioneer 🚀
            </Text>
            <Text style={{ textAlign: 'center', fontSize: 14, color: '#444' }}>
              Share your date with friends — it’s all better with good company. 🍸
            </Text>
          </View>
        </ScrollView>
      ) : (
        <FlatList<CardUser>
          data={users}
          key={viewMode}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          numColumns={viewMode === 'grid' ? 2 : 1}
          columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: bottomStackPadding }}
          extraData={invitedUserIds}
          ListFooterComponent={
            loading && users.length > 0 ? (
              <View style={{ paddingVertical: 12 }}>
                <ActivityIndicator />
              </View>
            ) : null
          }
        />
      )}

      {/* Bottom actions (sticky) */}
      <TouchableOpacity style={[styles.inviteButton, { bottom: 20 + insets.bottom + 52 + 12 }]} onPress={handleShareInvite}>
        <Text style={styles.buttonText}>Invite via Text</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.doneButton, { bottom: 20 + insets.bottom }]} onPress={goToMyDatesTab}>
        <Text style={styles.buttonText}>Done</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

/* --------------------------------- styles -------------------------------- */
const CHIP_HEIGHT = 40;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DRYNKS_WHITE },

  header: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    backgroundColor: DRYNKS_WHITE,
  },
  logo: { width: 36, height: 36, resizeMode: 'contain' },
  toggle: { fontSize: 14, color: DRYNKS_RED, fontWeight: '600' },

  radiusBar: { paddingVertical: 8, paddingLeft: 16, backgroundColor: '#fff' },
  radiusChip: {
    height: CHIP_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: CHIP_HEIGHT / 2,
    borderColor: DRYNKS_BLUE,
    borderWidth: 1,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  radiusChipSelected: { backgroundColor: DRYNKS_BLUE, borderColor: DRYNKS_BLUE },
  radiusChipText: { fontSize: 14, color: DRYNKS_BLUE },
  radiusChipTextSelected: { color: DRYNKS_WHITE, fontWeight: '700' },

  card: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#fff',
    paddingBottom: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 4 },
    }),
  },
  gridCard: { width: (width - 48) / 2, marginBottom: 16 },

  inviteButton: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: DRYNKS_BLUE,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButton: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: DRYNKS_RED,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: DRYNKS_WHITE, fontWeight: '600', fontSize: 16 },
});

export default InviteNearbyScreen;
