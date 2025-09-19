// src/components/cards/DateCard.tsx
// Production-ready, context-aware DateCard.
// Keeps your original features (cover resolver, gallery typing, idempotent join_requests),
// and adds context-driven actions (accept/decline/leave/cancel/chat) with swipe gestures.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  FlatList,
  Alert,
  TextInput,
  Linking,
  Platform,
  Share,
  ToastAndroid,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler'; // standardized import
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import StatusBadge from '@components/common/StatusBadge';
import { createShareInviteLink } from '@services/InviteLinks'; // single-use invite link API

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const H_PADDING = 12;
const CARD_WIDTH = SCREEN_WIDTH - H_PADDING * 2;
const IMAGE_HEIGHT = Math.round(CARD_WIDTH / 1.618);

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const DEFAULT_DATE_BUCKET = 'date-photos';

/* --------------------------------- contexts -------------------------------- */
export type DateCardContext =
  | 'FEED'
  | 'RECEIVED_INVITES'
  | 'MY_ACCEPTED'
  | 'MY_CREATED'
  | 'SENT_INVITES';

type InviteRow = {
  id?: string; // tolerate either id or req_id
  req_id?: string;
  date_id: string;
  status:
    | 'pending'
    | 'accepted'
    | 'declined'
    | 'cancelled'
    | 'removed_by_host'
    | 'date_cancelled';
  inviter_id?: string | null; // naming hygiene (your table uses inviter_id)
  invitee_id?: string | null;
};

/* ----------------------------- in-memory caches ---------------------------- */

type MetaRow = {
  event_type?: string | null;
  preferred_gender_counts?: any;
  remaining_gender_counts?: any;
  spots?: number | null;
};
const metaCache = new Map<string, MetaRow>();

/* ----------------------------- little helpers ----------------------------- */

const toast = (msg: string) => {
  if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
};

const friendlyPayLabel = (raw?: string | null, screenname?: string) => {
  if (!raw) return '💸 Unknown';
  const lower = String(raw).toLowerCase().trim();

  const hostSyn = /(host|i\s*(am|'m)?\s*pay(ing)?|i\s*pay|me\s*pay|my\s*treat|on\s*me)/i;
  const sponsorSyn = /(sponsor|sponsored|looking\s*for\s*sponsor|need\s*sponsor)/i;
  const splitSyn = /(split|50\/?50|dutch|go(ing)?\s*dutch|half|share(d)?|each\s*pays)/i;

  if (sponsorSyn.test(lower)) return '🤑 Looking for Sponsor';
  if (hostSyn.test(lower)) return `🧾 ${screenname || 'Host'} Pays`;
  if (splitSyn.test(lower)) return '🤝 Going Dutch';

  if (lower === 'host' || lower === 'host pays') return `🧾 ${screenname || 'Host'} Pays`;
  if (lower === 'sponsor') return '🤑 Looking for Sponsor';
  if (lower === 'split') return '🤝 Going Dutch';

  return `💰 ${raw}`;
};

const toUrl = (p: any): string | null => {
  if (!p) return null;
  if (typeof p === 'string') return p;
  if ((p as any).url) return String((p as any).url);
  if ((p as any).photo) return String((p as any).photo);
  return null;
};

function normalizeArray(arrOrStr?: any): string[] {
  if (!arrOrStr) return [];
  try {
    if (typeof arrOrStr === 'string') {
      if (/^\s*\[/.test(arrOrStr)) {
        const parsed = JSON.parse(arrOrStr);
        return Array.isArray(parsed) ? (parsed.map(toUrl).filter(Boolean) as string[]) : [];
      }
      if (/^https?:\/\//i.test(arrOrStr)) return [arrOrStr];
      if (/^[^/]+\/[^/].+/.test(arrOrStr)) return [arrOrStr]; // "bucket/path.jpg"
      if (arrOrStr.includes(',')) return arrOrStr.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    }
    if (Array.isArray(arrOrStr)) return arrOrStr.map(toUrl).filter(Boolean) as string[];
    return [];
  } catch {
    if (typeof arrOrStr === 'string' && /^https?:\/\//i.test(arrOrStr)) return [arrOrStr];
    return [];
  }
}

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const ageFromBirthdate = (birthdate?: string | null) => {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(+d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

const getProfileId = (p: any) => p?.id || p?.profile_id || p?.user_id || p?.userId || p?.uid || null;
const getCreatorIdFromDate = (date: any) =>
  date?.creator_id || date?.creator || date?.creator || getProfileId(date?.creator_profile) || null;

/** Map various key shapes to our 3 labels */
const canonGenderKey = (g?: any): 'Male' | 'Female' | 'TS' | null => {
  const s = String(g || '').toLowerCase();
  if (!s) return null;
  if (s === 'male' || s.startsWith('m')) return 'Male';
  if (s === 'female' || s.startsWith('f')) return 'Female';
  if (s === 'ts' || s.startsWith('t') || s.includes('trans')) return 'TS';
  return null;
};

/** Accepts JSON string or JSON object; coerces numeric strings; returns 0 for missing keys */
const canonicalizeCounts = (raw: any): Record<'Male' | 'Female' | 'TS', number> => {
  const out: Record<'Male' | 'Female' | 'TS', number> = { Male: 0, Female: 0, TS: 0 };
  if (raw == null) return out;

  let obj: any = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return out;
    }
  }
  if (typeof obj !== 'object') return out;

  for (const [k, v] of Object.entries(obj)) {
    const key = canonGenderKey(k);
    if (!key) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
};

const sumCounts = (c: Record<'Male' | 'Female' | 'TS', number>) =>
  (c.Male || 0) + (c.Female || 0) + (c.TS || 0);

/* ----------------------- supabase storage url resolver ---------------------- */

async function resolveSupabaseUrlAuto(pathOrUrl?: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  const s = String(pathOrUrl);

  if (/^https?:\/\//i.test(s)) return s;

  // If looks like "bucket/path"
  if (/^[^/]+\/[^/].+/.test(s)) {
    const firstSlash = s.indexOf('/');
    theBucket: {
      const bucket = s.slice(0, firstSlash);
      const objectPath = s.slice(firstSlash + 1);
      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 3600);
        if (!error && data?.signedUrl) return data.signedUrl;
        const pub = supabase.storage.from(bucket).getPublicUrl(objectPath);
        return pub?.data?.publicUrl ?? null;
      } catch {
        // ignore and fall through
      }
    }
  }

  // Else treat it as object path in default bucket
  try {
    const { data, error } = await supabase.storage.from(DEFAULT_DATE_BUCKET).createSignedUrl(s, 3600);
    if (!error && data?.signedUrl) return data.signedUrl;
    const pub = supabase.storage.from(DEFAULT_DATE_BUCKET).getPublicUrl(s);
    return pub?.data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

function collectDatePhotoCandidates(date: any): string[] {
  const ordered = [date?.cover_image_url, date?.cover_photo, date?.banner_url, date?.event_photo];
  const pathish  = [date?.cover_image_path, date?.banner_path];
  const arrays   = [date?.photo_urls, date?.photo_url, date?.photo_paths, date?.images, date?.media, date?.photos, date?.gallery];

  const out: string[] = [];
  for (const x of ordered) {
    const u = toUrl(x);
    if (u) out.push(u);
  }
  for (const p of pathish) {
    const u = toUrl(p) || (typeof p === 'string' ? p : null);
    if (u) out.push(u);
  }
  for (const arr of arrays) out.push(...normalizeArray(arr));

  // De-dupe
  const seen = new Set<string>();
  return out.filter((u) => (u ? (!seen.has(u) && (seen.add(u), true)) : false));
}

/* --------------------------------- props --------------------------------- */

type DateCardProps = {
  date: any;
  userId: string;

  /** Where the card is shown; drives which actions/gestures are available. */
  context?: DateCardContext;

  /** Invite row (or at least its id), required for RECEIVED_INVITES/SENT_INVITES contexts. */
  invite?: InviteRow;

  isCreator?: boolean; // back-compat with older screens
  isAccepted?: boolean; // back-compat for showing Chat button
  disabled?: boolean;

  // Callbacks used by hosting lists to update locally after an action.
  onChanged?: (ev: 'removed' | 'updated', payload?: any) => void;

  onAccept?: () => void;
  onChat?: () => void;
  onPressProfile?: (profileId: string) => void;
  onPressCard?: () => void;
  onNotInterested?: () => void;

  /** Hide Not Interested / Request to Join (e.g., Received Invites) */
  disableFooterCtas?: boolean;

  /** Optional: open OS share sheet from parent without losing header */
  onInviteFriends?: () => void;

  /** Optional: hard-order images; if omitted we derive event → host → guests */
  imageUrlsOverride?: Array<string | null | undefined>;
};

/* --------------------------------- component --------------------------------- */

const DateCard: React.FC<DateCardProps> = ({
  date,
  userId,
  context = 'FEED',
  invite,
  isCreator,
  isAccepted,
  disabled,
  onChanged,
  onAccept,
  onChat,
  onPressProfile,
  onPressCard,
  onNotInterested,
  disableFooterCtas,
  onInviteFriends,
  imageUrlsOverride,
}) => {
  const navigation = useNavigation<any>();
  const swipeRef = useRef<Swipeable | null>(null);

  const [requested, setRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [showInviteOptions, setShowInviteOptions] = useState(false);
  const [username, setUsername] = useState('');
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [dropdownClosedByTap, setDropdownClosedByTap] = useState(false);
  const [userSuggestions, setUserSuggestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const flatListRef = useRef<FlatList<any>>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  // Authoritative fallback pulled from public.date_requests when needed
  const [drFallback, setDrFallback] = useState<MetaRow | null>(null);

  // Hydrate "requested" from AsyncStorage AND Supabase (idempotent / cross-device)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = `requested_${date?.id}`;
      const local = await AsyncStorage.getItem(key);
      if (!cancelled && local === 'true') setRequested(true);

      if (date?.id && userId) {
        const { data, error } = await supabase
          .from('join_requests')
          .select('id')
          .eq('date_id', String(date.id))
          .eq('requester_id', String(userId))
          .eq('status', 'pending')
          .limit(1);
        if (!cancelled && !error && Array.isArray(data) && data.length > 0) {
          setRequested(true);
          await AsyncStorage.setItem(key, 'true');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [date?.id, userId]);

  // Robust cover resolver (checks many fields + auto bucket detection)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const candidates = collectDatePhotoCandidates(date);

      for (const cand of candidates) {
        const resolved = await resolveSupabaseUrlAuto(cand);
        if (resolved) {
          if (!cancelled) setCoverUrl(resolved);
          return;
        }
      }

      // Fallback: if date.profile_photo looks different from host photo, try that
      const dp = toUrl(date?.profile_photo);
      const hp = toUrl(date?.creator_profile?.profile_photo);
      if (dp && dp !== hp) {
        const resolved = await resolveSupabaseUrlAuto(dp);
        if (!cancelled && resolved) {
          setCoverUrl(resolved);
          return;
        }
      }

      // Absolute last resort: host photo
      const fallback =
        toUrl(date?.creator_profile?.profile_photo) ||
        (normalizeArray(date?.creator_profile?.gallery_photos)[0] ?? null);

      if (!cancelled) setCoverUrl(fallback ?? null);
    })();

    return () => { cancelled = false; };
  }, [
    date?.cover_image_url,
    date?.cover_photo,
    date?.banner_url,
    date?.event_photo,
    date?.cover_image_path,
    date?.banner_path,
    date?.photo_paths,
    date?.photo_urls,
    date?.photo_url,
    date?.images,
    date?.media,
    date?.photos,
    date?.gallery,
    date?.profile_photo,
    date?.creator_profile,
  ]);

  // Username suggestions (for Invite Friends → in‑app)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (username.trim().length < 2) {
        setUserSuggestions([]);
        return;
      }
      setLoadingSuggestions(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, screenname, profile_photo')
        .ilike('screenname', `%${username}%`)
        .neq('id', userId)
        .limit(5);

      if (!cancelled) {
        if (!error && data) setUserSuggestions(data);
        setLoadingSuggestions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username, userId]);

  /* ------------------------------ derived values ----------------------------- */

  const accepted: any[] = Array.isArray(date?.accepted_profiles) ? date.accepted_profiles : [];

  const eventIsPast = date?.event_date ? new Date(date.event_date) < new Date() : false;

  /** Prefer props; if missing or all-zero, get fallback from date_requests */
  const rawPreferred = date?.preferred_gender_counts ?? drFallback?.preferred_gender_counts ?? {};
  const rawRemaining = date?.remaining_gender_counts ?? drFallback?.remaining_gender_counts ?? {};
  const totals = useMemo(() => canonicalizeCounts(rawPreferred), [rawPreferred]);
  const remainingCounts = useMemo(() => canonicalizeCounts(rawRemaining), [rawRemaining]);

  // Sum for "spots left" pill and total capacity (prefer preferred counts, else spots)
  const totalCapacityFromPreferred = sumCounts(totals);
  const spotsLeftFromRemaining = sumCounts(remainingCounts);

  const totalCapacity =
    totalCapacityFromPreferred > 0
      ? totalCapacityFromPreferred
      : typeof date?.spots === 'number' && date.spots > 0
      ? date.spots
      : typeof drFallback?.spots === 'number' && (drFallback!.spots as number) > 0
      ? (drFallback!.spots as number)
      : undefined;

  const spotsLeft =
    spotsLeftFromRemaining > 0
      ? spotsLeftFromRemaining
      : typeof totalCapacity === 'number'
      ? Math.max(totalCapacity - (accepted?.length || 0), 0)
      : 0;

  // Capacity per gender strictly remaining / preferred (no inference)
  const maleRem = remainingCounts.Male || 0;
  const maleTot = totals.Male || 0;

  const femaleRem = remainingCounts.Female || 0;
  const femaleTot = totals.Female || 0;

  const tsRem = remainingCounts.TS || 0;
  const tsTot = totals.TS || 0;

  const displayLocation = !looksLikeWKTOrHex(date?.location)
    ? String(date?.location ?? '')
    : date?.creator_profile?.location ?? '';

  const orientationText = useMemo(() => {
    const v = date?.orientation_preference;
    if (Array.isArray(v) && v.length) return v.join(', ');
    if (typeof v === 'string' && v.trim()) return v;
    return 'Everyone';
  }, [date?.orientation_preference]);

  // Event Type resolver (prefer correct DB value if feed value is missing or equals title)
  const resolvedEventType = useMemo(() => {
    const feed = (date?.event_type ?? '').toString().trim();
    const fallback = (drFallback?.event_type ?? '').toString().trim();
    const title = (date?.title ?? '').toString().trim();
    if (feed && (!title || feed.toLowerCase() !== title.toLowerCase())) return feed;
    if (fallback) return fallback;
    return '';
  }, [date?.event_type, drFallback?.event_type, date?.title]);

  /* -------- authoritative meta fetch (date_requests) when needed (cached) ---- */

  useEffect(() => {
    let cancelled = false;

    const title = (date?.title ?? '').toString().trim();
    const feedEventType = (date?.event_type ?? '').toString().trim();
    const eventTypeLooksLikeTitle =
      !!feedEventType && !!title && feedEventType.toLowerCase() === title.toLowerCase();

    const totalsSum = sumCounts(totals);
    const remainingSum = sumCounts(remainingCounts);

    const needEventType = !feedEventType || eventTypeLooksLikeTitle;
    const needPreferredCounts = totalsSum === 0;
    const needRemainingCounts = remainingSum === 0;

    if (!needEventType && !needPreferredCounts && !needRemainingCounts) return;

    // Build a stable cache key
    const keyValue = String(date?.id || date?.date_request_id || '');
    if (!keyValue) return;

    const cached = metaCache.get(keyValue);
    if (cached) {
      if (!cancelled) setDrFallback((prev) => ({ ...(prev || {}), ...cached }));
      return;
    }

    // helper: try a table for a given column match
    const fetchFrom = async (table: string, col: 'id' | 'date_request_id', val: string) => {
      try {
        const cols =
          table === 'dates'
            ? 'preferred_gender_counts, remaining_gender_counts, spots'
            : 'event_type, preferred_gender_counts, remaining_gender_counts, spots';

        const { data, error } = await supabase
          .from(table)
          .select(cols)
          .eq(col, val)
          .limit(1);

        if (!error && Array.isArray(data) && data.length > 0) return data[0] as MetaRow;
      } catch {
        /* ignore */
      }
      return null;
    };

    (async () => {
      // 1) Try date_requests by id
      let row =
        (date?.id && (await fetchFrom('date_requests', 'id', String(date.id)))) ||
        (date?.date_request_id &&
          (await fetchFrom('date_requests', 'id', String(date.date_request_id))));

      // 2) Fallback to dates table (no event_type on this table)
      if (!row) {
        row =
          (date?.id && (await fetchFrom('dates', 'id', String(date.id)))) ||
          (date?.date_request_id && (await fetchFrom('dates', 'id', String(date.date_request_id))));
      }

      if (!cancelled && row) {
        metaCache.set(keyValue, row);
        setDrFallback((prev) => ({ ...(prev || {}), ...row }));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    date?.id,
    date?.date_request_id,
    date?.event_type,
    date?.title,
    totals.Male,
    totals.Female,
    totals.TS,
    remainingCounts.Male,
    remainingCounts.Female,
    remainingCounts.TS,
  ]);

  /* ------------------------------ navigate helpers --------------------------- */

  const safeNavigateToProfile = (pid: string, e?: any) => {
    e?.stopPropagation?.();
    if (onPressProfile) {
      onPressProfile(pid);
      return;
    }
    try {
      navigation.navigate('Profile', { userId: pid, origin: 'DateFeed' });
      return;
    } catch {}
    try {
      navigation.navigate('PublicProfile', { userId: pid, origin: 'DateFeed' });
      return;
    } catch {}
    try {
      navigation.navigate('ProfileDetails', { userId: pid, origin: 'DateFeed' });
      return;
    } catch {}
    try {
      navigation.navigate('UserProfile', { userId: pid, origin: 'DateFeed' });
      return;
    } catch {}
    const url = `dr-ynks://profile/${encodeURIComponent(pid)}?origin=DateFeed`;
    Linking.openURL(url).catch(() => {});
  };
  const goToProfile = (pid?: string | null, e?: any) => {
    if (pid) safeNavigateToProfile(String(pid), e);
  };

  // Prefer ManageApplicants; fallback to other potential route names; last resort open chat
  const smartManageNavigate = (dateId: string) => {
    const candidates = [
      { name: 'ManageApplicants', params: { dateId } }, // primary route in your AppNavigator
      { name: 'ManageParticipants', params: { dateId } },
      { name: 'Participants', params: { dateId } },
      { name: 'ManageAttendees', params: { dateId } },
      { name: 'GroupChat', params: { dateId } }, // last-resort fallback
    ];
    for (const c of candidates) {
      try {
        navigation.navigate(c.name as any, c.params as any);
        return;
      } catch {}
    }
  };

  /* ------------------------------- gallery data ------------------------------ */

  type Slide = { type: 'event' | 'creator' | 'accepted'; url?: string; profile?: any };

  const gallery: Slide[] = useMemo(() => {
    // 1) If parent forced order, attempt to type each URL (event/host/guest)
    if (Array.isArray(imageUrlsOverride) && imageUrlsOverride.length) {
      const hostUrl = toUrl(date?.creator_profile?.profile_photo) || '';
      const acceptedList: any[] = Array.isArray(date?.accepted_profiles)
        ? date.accepted_profiles
        : [];
      const acceptedMap = new Map<string, any>();
      for (const p of acceptedList) {
        const u = toUrl(p?.profile_photo);
        if (u) acceptedMap.set(u, p);
      }

      const seen = new Set<string>();
      const slides: Slide[] = [];
      for (const raw of imageUrlsOverride) {
        const u = raw ? String(raw) : '';
        if (!u || seen.has(u)) continue;
        seen.add(u);
        if (u === hostUrl) {
          slides.push({ type: 'creator', profile: date?.creator_profile });
        } else if (acceptedMap.has(u)) {
          slides.push({ type: 'accepted', profile: acceptedMap.get(u) });
        } else {
          slides.push({ type: 'event', url: u });
        }
      }
      if (slides.length) return slides;
      // fall through to auto if we somehow ended with nothing
    }

    // 2) Auto: event → host → accepted (dedup)
    const slides: Slide[] = [];
    const added = new Set<string>();

    const pushEvent = (url?: string | null) => {
      if (url) {
        const u = String(url);
        if (!added.has(u)) {
          slides.push({ type: 'event', url: u });
          added.add(u);
        }
      }
    };
    const pushProfile = (type: 'creator' | 'accepted', p: any) => {
      const u = toUrl(p?.profile_photo);
      if (u && !added.has(u)) {
        slides.push({ type, profile: p });
        added.add(u);
      }
    };

    pushEvent(coverUrl);
    if (date?.creator_profile?.profile_photo) pushProfile('creator', date.creator_profile);
    const acc: any[] = Array.isArray(accepted) ? accepted : [];
    for (const p of acc) if (p?.profile_photo) pushProfile('accepted', p);
    if (slides.length === 0 && date?.creator_profile?.profile_photo)
      pushProfile('creator', date.creator_profile);

    return slides;
  }, [imageUrlsOverride, coverUrl, date?.creator_profile, date?.accepted_profiles, accepted]);

  const showDots = gallery.length > 1;

  /* ------------------------------ server actions ----------------------------- */

  const notifyHost = async (msg: string) => {
    try {
      const creator_id = getCreatorIdFromDate(date);
      if (!creator_id || creator_id === userId) return;
      await supabase.from('notifications').insert([
        { user_id: creator_id, message: msg, screen: 'MyDates', params: { date_id: date.id } },
      ]);
    } catch {
      /* ignore */
    }
  };

  const handleRequest = async () => {
    if (requesting || requested) return;
    const dateId = String(date?.id || '');
    if (!dateId) {
      Alert.alert('Missing date', 'Cannot request to join—no date id.');
      return;
    }
    setRequesting(true);
    try {
      // Idempotency: check if a pending request already exists
      const { data: existing, error: checkErr } = await supabase
        .from('join_requests')
        .select('id')
        .eq('date_id', dateId)
        .eq('requester_id', String(userId))
        .eq('status', 'pending')
        .limit(1);

      if (!checkErr && Array.isArray(existing) && existing.length > 0) {
        await AsyncStorage.setItem(`requested_${dateId}`, 'true');
        setRequested(true);
        Alert.alert('Already requested', 'Your request is already pending.');
        return;
      }

      const creator_id = getCreatorIdFromDate(date);
      const payload: any = {
        date_id: dateId,
        requester_id: String(userId),
        status: 'pending',
      };
      if (creator_id) payload.recipient_id = String(creator_id); // trigger also enforces this

      const { error } = await supabase.from('join_requests').insert([payload]);
      if (error) throw error;

      await AsyncStorage.setItem(`requested_${dateId}`, 'true');
      setRequested(true);
      Alert.alert('🎉 Date Requested', 'Check My Join Requests to follow up.');
      onAccept && onAccept();
      await notifyHost('💌 You have a join request on your date.');
    } catch (e: any) {
      let msg = e?.message || 'Could not submit your request.';
      if (e?.code === '23505') {
        await AsyncStorage.setItem(`requested_${dateId}`, 'true');
        setRequested(true);
        msg = 'Your request is already pending.';
      } else if (e?.code === '23503') {
        msg = 'This event is not available yet. Please try again shortly.';
      }
      console.error('[DateCard] join_requests insert error:', e);
      Alert.alert('Error', msg);
    } finally {
      setRequesting(false);
    }
  };

  // Safe Chat: call parent if provided, else navigate directly
  const handleJoinChat = () => {
    if (onChat) {
      onChat();
      return;
    }
    try {
      navigation.navigate('GroupChat' as any, { dateId: String(date?.id) });
    } catch {}
  };

  // RECEIVED_INVITES → Accept/Decline
  const acceptInvite = async () => {
    const reqId = invite?.req_id || invite?.id;
    if (!reqId || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('invites_decide', {
        p_req_id: reqId,
        p_decision: 'accepted',
      });
      if (error) throw error;

      const suppress = await AsyncStorage.getItem('suppress_move_to_accepted_toast');
      if (!suppress) {
        Alert.alert('Added to My Dates', 'This date was moved to your Accepted list.', [
          { text: 'OK' },
          {
            text: 'Don’t show again',
            onPress: () => AsyncStorage.setItem('suppress_move_to_accepted_toast', '1'),
          },
        ]);
      } else {
        toast('Moved to My Dates');
      }

      onChanged?.('removed', { reason: 'accepted' });
    } catch (e: any) {
      Alert.alert('Accept failed', e?.message || 'Please try again.');
    } finally {
      swipeRef.current?.close?.();
      setBusy(false);
    }
  };

  const declineInvite = async () => {
    const reqId = invite?.req_id || invite?.id;
    if (!reqId || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('invites_decide', {
        p_req_id: reqId,
        p_decision: 'declined',
      });
      if (error) throw error;
      onChanged?.('removed', { reason: 'declined' });
    } catch (e: any) {
      Alert.alert('Decline failed', e?.message || 'Please try again.');
    } finally {
      swipeRef.current?.close?.();
      setBusy(false);
    }
  };

  // MY_ACCEPTED → Leave
  const leaveDate = async () => {
    if (busy) return;
    Alert.alert('Leave this date?', 'You’ll be removed from the event and its group chat.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const { error } = await supabase.rpc('dates_leave', { p_date_id: date.id });
            if (error) throw error;
            onChanged?.('removed', { reason: 'left' });
          } catch (e: any) {
            Alert.alert('Could not leave', e?.message || 'Please try again.');
          } finally {
            swipeRef.current?.close?.();
            setBusy(false);
          }
        },
      },
    ]);
  };

  // MY_CREATED → Cancel
  const cancelDate = async () => {
    Alert.alert('Cancel date?', 'This removes invites, attendees, and the group chat.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancel Date',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.rpc('host_cancel_date', { p_date_id: date.id });
            if (error) throw error;
            onChanged?.('removed', { reason: 'cancelled' });
          } catch (e: any) {
            Alert.alert('Cancel failed', e?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  /* -------------------------------- share/invite ----------------------------- */

  // Share via social/text using a single-use deep link created by the backend.
  const shareInvite = async () => {
    if (onInviteFriends) {
      onInviteFriends();
      return;
    }
    try {
      const dateId = String(date?.id || '');
      if (!dateId) throw new Error('Missing date id');
      const { url } = await createShareInviteLink(dateId, String(userId));
      const message =
        `🎉 Join me on DrYnks for "${date.title}"!\n\n` +
        `Tap to view the date (you’ll be guided to the app):\n${url}`;
      await Share.share({ message });
      await supabase.from('notifications').insert([
        {
          user_id: userId,
          message: `Shared invite to "${date.title}"`,
          screen: 'MyDates',
          params: { date_id: date.id, action: 'share_social' },
        },
      ]);
    } catch (err: any) {
      Alert.alert('Error sharing invite', err?.message || String(err));
    }
  };

  /* ---------------------------- swipe action render --------------------------- */

  const renderLeftActions = () => {
    if (context === 'RECEIVED_INVITES') {
      return (
        <TouchableOpacity
          style={[styles.swipeAction, styles.accept]}
          onPress={acceptInvite}
          disabled={busy}
        >
          <Text style={styles.swipeText}>Accept</Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  const renderRightActions = () => {
    if (context === 'RECEIVED_INVITES') {
      return (
        <TouchableOpacity
          style={[styles.swipeAction, styles.decline]}
          onPress={declineInvite}
          disabled={busy}
        >
          <Text style={styles.swipeText}>Decline</Text>
        </TouchableOpacity>
      );
    }
    if (context === 'MY_ACCEPTED') {
      return (
        <TouchableOpacity
          style={[styles.swipeAction, styles.decline]}
          onPress={leaveDate}
          disabled={busy}
        >
          <Text style={styles.swipeText}>Leave</Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  const enableLeft = context === 'RECEIVED_INVITES';
  const enableRight = context === 'RECEIVED_INVITES' || context === 'MY_ACCEPTED';

  /* --------------------------------- renders -------------------------------- */

  const renderMainOverlay = () => {
    const hostPid = getCreatorIdFromDate(date);

    return (
      <View style={styles.textOverlay}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={2}>
            {String(date.title || '')}
          </Text>
          <View style={styles.spotsPill}>
            <Text style={styles.spotsText}>
              {typeof spotsLeft === 'number' && typeof totalCapacity === 'number'
                ? spotsLeft > 0
                  ? `${spotsLeft} left`
                  : 'No spots'
                : ''}
            </Text>
          </View>
        </View>

        <StatusBadge status={eventIsPast ? 'closed' : 'open'} />

        <Text style={styles.meta}>
          {date?.event_date ? new Date(date.event_date).toDateString() : ''}
          {typeof date.distance_miles === 'number'
            ? ` • ${Number(date.distance_miles).toFixed(1)} mi`
            : ''}
        </Text>

        {!!displayLocation && <Text style={styles.meta}>{displayLocation}</Text>}

        <TouchableOpacity onPress={(e) => goToProfile(String(hostPid), e)} activeOpacity={0.8}>
          <Text style={styles.meta}>
            Host: <Text style={styles.link}>{date?.creator_profile?.screenname || 'Unknown'}</Text>
          </Text>
        </TouchableOpacity>

        <Text style={styles.meta}>
          {friendlyPayLabel(date?.who_pays, date?.creator_profile?.screenname)}
        </Text>

        <Text style={styles.meta}>Orientation: {orientationText}</Text>
        <Text style={styles.meta}>Event Type: {resolvedEventType || '—'}</Text>

        {/* Capacity: Male / Female / TS from remaining_gender_counts / preferred_gender_counts */}
        <View style={{ marginTop: 2 }}>
          <Text style={[styles.meta, { fontWeight: '700' }]}>Capacity (available / total)</Text>
          <Text style={styles.meta}>
            Male {maleRem}/{maleTot}
            {' • '}Female {femaleRem}/{femaleTot}
            {' • '}TS {tsRem}/{tsTot}
          </Text>
        </View>
      </View>
    );
  };

  const renderProfileOverlay = (p: any, labelPrefix = 'Host') => {
    const age = ageFromBirthdate(p?.birthdate);
    const city = p?.location;
    const pid = getProfileId(p);

    const interestedArr =
      (Array.isArray(p?.preferences) && p.preferences) ||
      (Array.isArray(p?.orientation) && p.orientation) ||
      (Array.isArray(p?.interested_in) && p.interested_in) ||
      (typeof p?.orientation === 'string' ? [p.orientation] : []) ||
      (typeof p?.interested_in === 'string' ? [p?.interested_in] : []);

    const interestedStr = (interestedArr || []).filter(Boolean).join(', ');

    return (
      <View style={styles.textOverlay}>
        <TouchableOpacity onPress={(e) => goToProfile(String(pid), e)} activeOpacity={0.8}>
          <Text style={styles.title}>
            {labelPrefix}: <Text style={styles.link}>{p?.screenname || 'User'}</Text>
            {age ? `, ${age}` : ''}
          </Text>
        </TouchableOpacity>
        <Text style={styles.meta}>{city ? city : ''}</Text>
        {p?.gender ? <Text style={styles.meta}>Gender: {p.gender}</Text> : null}
        {interestedStr ? <Text style={styles.meta}>Interested in: {interestedStr}</Text> : null}
      </View>
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    const p = item.profile;
    const pid = getProfileId(p); // maintain consistent typing
    const imgUri = item.type === 'event' ? item.url : p?.profile_photo;

    const handleSlidePress =
      item.type === 'event'
        ? () => {
            onPressCard && onPressCard();
          }
        : () => goToProfile(String(pid));

    return (
      <TouchableOpacity activeOpacity={0.92} onPress={handleSlidePress}>
        <View style={styles.slide}>
          {imgUri ? (
            <Image source={{ uri: imgUri }} style={styles.image} />
          ) : (
            <View
              style={[
                styles.image,
                { backgroundColor: '#0f141a', alignItems: 'center', justifyContent: 'center' },
              ]}
            >
              <Text style={{ color: '#fff', opacity: 0.7 }}>No photo yet</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.78)']}
            style={styles.overlay}
            pointerEvents="none"
          />
          {item.type === 'event' && renderMainOverlay()}
          {item.type === 'creator' && renderProfileOverlay(p, 'Host')}
          {item.type === 'accepted' && renderProfileOverlay(p, 'Guest')}
        </View>
      </TouchableOpacity>
    );
  };

  /* ---------------------------------- UI ---------------------------------- */

  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={enableLeft ? renderLeftActions : undefined}
      renderRightActions={enableRight ? renderRightActions : undefined}
      enabled={enableLeft || enableRight}
      overshootFriction={8}
      friction={2}
    >
      <View style={styles.card}>
        <View style={{ position: 'relative' }}>
          <View style={styles.counterPill} pointerEvents="none">
            <Text style={styles.counterText}>{gallery.length} 📸</Text>
          </View>

          <FlatList
            ref={flatListRef}
            horizontal
            pagingEnabled
            data={gallery}
            keyExtractor={(_, i) => `g-${i}`}
            renderItem={renderItem}
            snapToAlignment="start"
            decelerationRate={Platform.OS === 'ios' ? 'fast' : 0.98}
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_WIDTH}
            getItemLayout={(_, index) => ({
              length: CARD_WIDTH,
              offset: CARD_WIDTH * index,
              index,
            })}
            onScroll={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / CARD_WIDTH);
              if (idx !== currentIndex) setCurrentIndex(idx);
            }}
            scrollEventThrottle={16}
          />
        </View>

        {showDots && (
          <View style={styles.dotsRow}>
            {gallery.map((_: any, i: number) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === currentIndex && styles.dotActive,
                  i !== 0 && { marginLeft: 6 },
                ]}
              />
            ))}
          </View>
        )}

        {/* FEED context: original CTAs */}
        {context === 'FEED' && !eventIsPast && !disabled && !isCreator && !disableFooterCtas && (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={() => onNotInterested?.()}
              style={[styles.btn, styles.btnRed, { marginRight: 10 }]}
            >
              <Text style={styles.btnText}>Not Interested</Text>
            </TouchableOpacity>

            {!requested ? (
              <TouchableOpacity
                onPress={handleRequest}
                disabled={requesting}
                style={[styles.btn, styles.btnBlue, requesting && { opacity: 0.7 }]}
              >
                <Text style={styles.btnText}>{requesting ? 'Requesting…' : 'Request to Join'}</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.btn, styles.btnDisabled]}>
                <Text style={styles.btnText}>Requested</Text>
              </View>
            )}
          </View>
        )}

        {/* RECEIVED_INVITES context: buttons (in addition to swipe) */}
        {context === 'RECEIVED_INVITES' && (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={acceptInvite}
              style={[styles.btn, styles.btnBlue, { marginRight: 10 }]}
              disabled={busy}
            >
              <Text style={styles.btnText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={declineInvite} style={[styles.btn, styles.btnRed]} disabled={busy}>
              <Text style={styles.btnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* MY_ACCEPTED context: Chat + Leave */}
        {(context === 'MY_ACCEPTED' || isAccepted) && !eventIsPast && (
          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={handleJoinChat} style={[styles.btn, styles.btnBlue, { marginRight: 10 }]}>
              <Text style={styles.btnText}>Chat</Text>
            </TouchableOpacity>
            {context === 'MY_ACCEPTED' && (
              <TouchableOpacity onPress={leaveDate} style={[styles.btn, styles.btnRed]} disabled={busy}>
                <Text style={styles.btnText}>Leave</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* MY_CREATED context: Manage + Cancel */}
        {context === 'MY_CREATED' && (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={() => smartManageNavigate(String(date.id))}
              style={[styles.btn, styles.btnDark, { marginRight: 10 }]}
            >
              <Text style={styles.btnText}>Manage</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={cancelDate} style={[styles.btn, styles.btnRed]} disabled={busy}>
              <Text style={styles.btnText}>Cancel Date</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* SENT_INVITES: status text */}
        {context === 'SENT_INVITES' && (
          <View style={[styles.buttonRow, { justifyContent: 'center' }]}>
            <Text style={{ color: '#6b7280', fontSize: 12 }}>Waiting for responses…</Text>
          </View>
        )}

        {/* Invite Friends (kept feature for discoverability) */}
        <TouchableOpacity
          onPress={() => {
            if (onInviteFriends) onInviteFriends();
            else setShowInviteOptions((s) => !s);
          }}
          style={styles.inviteBtn}
        >
          <Text style={styles.inviteText}>Invite Friends</Text>
        </TouchableOpacity>

        {showInviteOptions && (
          <View style={styles.inviteSection}>
            <Text style={styles.inviteOption}>🔍 Invite In-App</Text>
            <TextInput
              style={styles.inputBox}
              placeholder="Enter username"
              value={username}
              onChangeText={setUsername}
              onFocus={() => setDropdownClosedByTap(false)}
              onBlur={() => setDropdownClosedByTap(true)}
            />
            {loadingSuggestions ? (
              <Text style={styles.metaSmall}>Loading...</Text>
            ) : userSuggestions.length === 0 && username.length > 1 && !dropdownClosedByTap ? (
              <Text style={styles.metaSmall}>No matches found</Text>
            ) : (
              userSuggestions.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  onPress={() => {
                    (async () => {
                      try {
                        await supabase.from('notifications').insert([
                          {
                            user_id: u.id,
                            message: `${date.creator_profile?.screenname || 'Someone'} invited you to "${date.title}"`,
                            screen: 'MyDates',
                            params: { date_id: date.id, action: 'invite_inapp' },
                          },
                        ]);
                        Alert.alert('✅ Invite sent to ' + u.screenname);
                        setUsername(''); setUserSuggestions([]); setDropdownClosedByTap(true);
                      } catch (err: any) {
                        Alert.alert('Error sending invite', err.message || String(err));
                      }
                    })();
                  }}
                  style={styles.suggestionRow}
                >
                  {!!u.profile_photo && <Image source={{ uri: u.profile_photo }} style={styles.avatar} />}
                  <Text style={styles.metaSmall}>{u.screenname}</Text>
                </TouchableOpacity>
              ))
            )}

            <Text style={styles.inviteOption}>🌐 Share on Social</Text>
            <TouchableOpacity onPress={shareInvite} style={styles.inviteBtn}>
              <Text style={styles.inviteText}>Share Date</Text>
            </TouchableOpacity>

            <Text style={styles.inviteOption}>💬 Invite via Text</Text>
            <TouchableOpacity
              onPress={async () => {
                try {
                  const dateId = String(date?.id || '');
                  if (!dateId) throw new Error('Missing date id');
                  const { url } = await createShareInviteLink(dateId, String(userId));
                  const message =
                    `You've been invited to join DrYnks! 🎉\n` +
                    `Tap to view the date (you’ll be guided to the app):\n${url}`;
                  const smsUrl = Platform.select({
                    ios: `sms:&body=${encodeURIComponent(message)}`,
                    android: `sms:?body=${encodeURIComponent(message)}`,
                    default: `sms:?body=${encodeURIComponent(message)}`,
                  })!;
                  Linking.openURL(smsUrl).catch(() => {});
                  await supabase.from('notifications').insert([
                    {
                      user_id: userId,
                      message: `Shared invite (SMS) to "${date.title}"`,
                      screen: 'MyDates',
                      params: { date_id: date.id, action: 'share_text' },
                    },
                  ]);
                } catch (err: any) {
                  Alert.alert('Could not prepare text invite', err?.message || String(err));
                }
              }}
              style={styles.inviteBtn}
            >
              <Text style={styles.inviteText}>Send Text Invite</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Swipeable>
  );
};

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  card: {
    marginHorizontal: H_PADDING,
    marginVertical: 10,
    backgroundColor: DRYNKS_WHITE,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  slide: {
    width: CARD_WIDTH,
    height: IMAGE_HEIGHT,
    overflow: 'hidden',
    borderRadius: 20,
  },
  image: {
    width: CARD_WIDTH,
    height: IMAGE_HEIGHT,
    resizeMode: 'cover',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  textOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  spotsPill: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  spotsText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  title: { fontSize: 22, fontWeight: '800', color: DRYNKS_WHITE, flexShrink: 1, paddingRight: 10 },
  link: { color: '#e6f0ff', textDecorationLine: 'underline', fontWeight: '700' },
  meta: {
    fontSize: 14,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    paddingTop: 3,
  },
  metaSmall: {
    fontSize: 13,
    color: '#374151',
    paddingVertical: 2,
  },

  counterPill: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 5,
    backgroundColor: DRYNKS_RED,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  counterText: { color: 'white', fontWeight: '600' },

  dotsRow: { flexDirection: 'row', alignSelf: 'center', marginTop: 6, marginBottom: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#d3d7db' },
  dotActive: { backgroundColor: DRYNKS_BLUE },

  buttonRow: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 8, alignItems: 'center' },
  btn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnRed: { backgroundColor: DRYNKS_RED },
  btnBlue: { backgroundColor: DRYNKS_BLUE },
  btnDark: { backgroundColor: '#111827' },
  btnDisabled: { backgroundColor: '#A9B0B7' },
  btnText: { color: 'white', fontWeight: '700', fontSize: 14 },

  inviteBtn: {
    borderWidth: 1,
    borderColor: DRYNKS_BLUE,
    paddingVertical: 11,
    borderRadius: 12,
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  inviteText: { color: DRYNKS_BLUE, fontWeight: '700', fontSize: 15 },

  inviteSection: { paddingHorizontal: 16, paddingBottom: 18 },
  inviteOption: { marginTop: 6, marginBottom: 6, fontWeight: 'bold', color: DRYNKS_BLUE },
  inputBox: {
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 10 },

  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 100,
  },
  swipeText: { color: '#fff', fontWeight: '700' },
  accept: { backgroundColor: '#22C55E' },
  decline: { backgroundColor: '#EF4444' },
});

export default DateCard;
