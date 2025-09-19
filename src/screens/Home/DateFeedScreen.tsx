// src/screens/Home/DateFeedScreen.tsx
// Date Feed — production-ready, tolerant to both vw_feed_dates_v2 and vw_feed_dates
// FIXES:
//  - Provide creator screenname/birthdate/preferences so DateCard can show Host name + age
//  - Provide accepted_profiles with same fields so "Guest" slide shows name + age
//  - Populate who_pays from date_requests so DateCard doesn't show "💸 Unknown"
//  - NEW: If user comes in via an invite link we claimed after login, the linked date
//         is fetched and **pinned to the top immediately**, and we scroll to it.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  TextInput,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import DateCard from '@components/cards/DateCard';
import { tryPromptIfArmed } from '@services/QuickUnlockService';
import { supabase } from '@config/supabase';

// ⬇️ NEW: invite service — used to claim any pending deep-link and get date_id
import { consumePendingInviteAfterLogin } from '@services/InviteLinks';

// ---- Theme
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F5F5F5';
const DRYNKS_RED = '#E34E5C';

// ---- Filters
const sortOptions = ['Upcoming', 'Distance', 'Newest', 'Oldest'] as const;
const stateOptions = ['Available Dates', 'Filled Dates', 'Passed Dates', 'All'] as const;
const typeOptions = ['group', 'one-on-one'] as const;

type UUID = string;

type Profile = {
  id: UUID;
  gender: string | null;
  orientation: string | null;
  latitude: number | null;
  longitude: number | null;
  location?: string | null;
  profile_photo?: string | null;
};

type ProfileHydrated = {
  id: UUID;
  screenname?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  orientation?: string | null;
  profile_photo?: string | null;
  location?: string | null;
  preferences?: string[] | null;
};

type DateRow = {
  id: UUID;
  title: string | null;
  event_date: string | null;
  who_pays: string | null;
  event_type: string | null;
  orientation_preference: string[] | null;
  distance_miles: number | null;
  profile_photo: string | null; // creator/host avatar
  photo_urls: string[];         // first image will be used as cover by DateCard
  creator_id: UUID;
  creator_profile: ProfileHydrated | null;
  accepted_profiles: ProfileHydrated[] | null;
  created_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location?: string | null;
  spots?: number | null;
  remaining_gender_counts?: Record<string, number> | null;
};

const PAGE_SIZE = 10;

// Helpers
const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const hiddenKeyFor = (uid: string) => `hidden_dates_v1:${uid}`;

// Google Places
const GOOGLE_KEY =
  (process.env as any)?.EXPO_PUBLIC_GOOGLE_API_KEY ||
  (process.env as any)?.GOOGLE_API_KEY ||
  '';

type Suggestion = { description: string; place_id: string };
const AUTOCOMPLETE_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/details/json';

// Debounce hook
function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function DateFeedScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const flatListRef = useRef<FlatList<DateRow>>(null);

  // --- auth/profile ---
  const [userId, setUserId] = useState<UUID | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // --- data ---
  const [dates, setDates] = useState<DateRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // 🔴 NEW: a one-off "pinned" item (invite claimed) — always shown on top this session
  const [pinned, setPinned] = useState<DateRow | null>(null);

  // --- flags ---
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const onEndReachedOkRef = useRef(false);

  // --- filters (persisted) ---
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [radius, setRadius] = useState('250');
  const [filterText, setFilterText] = useState('');
  const [sortBy, setSortBy] = useState<(typeof sortOptions)[number]>('Upcoming');
  const [dateStateFilter, setDateStateFilter] = useState<(typeof stateOptions)[number]>('All');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['group', 'one-on-one']);
  const [locationName, setLocationName] = useState('');
  const [overrideCoords, setOverrideCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Suggestions state
  const [sessionToken] = useState<string>(uuidv4());
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(false);
  const debouncedQuery = useDebouncedValue(locationName, 250); // ✅ single declaration
  const hasPlaces = useMemo(() => !!GOOGLE_KEY, [GOOGLE_KEY]);
  const didInitLocationRef = useRef(false);

  // --- per-user hidden IDs ---
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // ----- persistence -----
  const persistFilters = useCallback(async () => {
    await AsyncStorage.multiSet([
      ['radius', radius],
      ['filterText', filterText],
      ['sortBy', sortBy],
      ['dateStateFilter', dateStateFilter],
      ['selectedTypes', JSON.stringify(selectedTypes)],
      ['locationName', locationName],
    ]);
  }, [radius, filterText, sortBy, dateStateFilter, selectedTypes, locationName]);

  const loadFilters = useCallback(async () => {
    const entries = await AsyncStorage.multiGet([
      'radius',
      'filterText',
      'sortBy',
      'dateStateFilter',
      'selectedTypes',
      'locationName',
    ]);
    const map = Object.fromEntries(entries);
    if (map.radius) setRadius(map.radius);
    if (map.filterText) setFilterText(map.filterText);
    if (map.sortBy) setSortBy(map.sortBy as (typeof sortOptions)[number]);
    if (map.dateStateFilter) setDateStateFilter(map.dateStateFilter as (typeof stateOptions)[number]);
    if (map.selectedTypes) setSelectedTypes(JSON.parse(map.selectedTypes));
    if (map.locationName) {
      setLocationName(map.locationName);
      didInitLocationRef.current = true;
    }
    setFiltersLoaded(true);
  }, []);

  // Load filters on mount
  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  // Load hidden IDs when userId known
  const loadHidden = useCallback(async (uid: string) => {
    try {
      const raw = await AsyncStorage.getItem(hiddenKeyFor(uid));
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      setHiddenIds(new Set(arr));
    } catch {
      setHiddenIds(new Set());
    }
  }, []);

  const saveHidden = useCallback(async (uid: string, nextSet: Set<string>) => {
    try {
      await AsyncStorage.setItem(hiddenKeyFor(uid), JSON.stringify(Array.from(nextSet)));
    } catch {
      // ignore
    }
  }, []);

  // ----- geocode helpers -----
  const reverseGeocodeToCity = useCallback(async (lat: number, lng: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const city = results?.[0]?.city || results?.[0]?.subregion || results?.[0]?.region;
      if (city) {
        setLocationName(city);
        await AsyncStorage.setItem('locationName', city);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshListRef = useRef<null | ((coords?: { lat: number; lng: number }) => Promise<void>)>(null);

  const getCurrentLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required.');
        return;
      }
      const { coords } = await Location.getCurrentPositionAsync({});
      setOverrideCoords({ lat: coords.latitude, lng: coords.longitude });
      await reverseGeocodeToCity(coords.latitude, coords.longitude);
      await persistFilters();
      if (userId && profile) refreshListRef.current?.({ lat: coords.latitude, lng: coords.longitude });
    } catch {
      Alert.alert('Location Error', 'Could not fetch your location.');
    }
  }, [persistFilters, profile, reverseGeocodeToCity, userId]);

  // ----- session/profile hydrate (single-init location) -----
  const hydrateSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      setUserId(null);
      setProfile(null);
      setDates([]);
      setPinned(null); // clear any session pin
      setHiddenIds(new Set());
      setLoadingInitial(false);
      setRefreshing(false);
      setFetchingMore(false);
      setFirstLoadDone(true);
      return;
    }

    const uid = session.user.id as UUID;
    setUserId(uid);
    loadHidden(uid);

    const { data: prof } = await supabase
      .from('profiles')
      .select('id, gender, orientation, latitude, longitude, location, profile_photo')
      .eq('id', uid)
      .single();

    if (prof) {
      setProfile(prof as Profile);
      if (!didInitLocationRef.current) {
        if ((prof as Profile).location) {
          setLocationName((prof as Profile).location as string);
          await AsyncStorage.setItem('locationName', (prof as Profile).location as string);
          didInitLocationRef.current = true;
        } else if ((prof as Profile).latitude != null && (prof as Profile).longitude != null) {
          await reverseGeocodeToCity((prof as Profile).latitude!, (prof as Profile).longitude!);
          didInitLocationRef.current = true;
        }
      }
    }
  }, [loadHidden, reverseGeocodeToCity]);

  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  // Re-hydrate on auth state changes
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      hydrateSession();
    });
    return () => sub.subscription?.unsubscribe();
  }, [hydrateSession]);

  // ======= FaceID / TouchID prompt on first arrival =======
  useEffect(() => {
    (async () => {
      const didPrompt = await tryPromptIfArmed(async (refresh_token) => {
        await supabase.auth.refreshSession({ refresh_token });
      });
      if (didPrompt) {
        await hydrateSession();
        await refreshListRef.current?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ======= FETCHING =======
  const canQuery = useMemo(() => !!userId && !!profile, [userId, profile]);

  const isPast = (d: DateRow) => {
    if (!d?.event_date) return false;
    const dt = new Date(d.event_date);
    return !Number.isNaN(+dt) && dt < new Date();
  };
  const isFull = (d: DateRow) => {
    const rgc = d.remaining_gender_counts;
    if (!rgc || typeof rgc !== 'object') return false;
    const vals = Object.values(rgc).filter(v => typeof v === 'number');
    if (vals.length === 0) return false;
    return vals.every(v => v === 0);
  };

  // derive viewer's gender (not used for filtering anymore, but we keep it if needed later)
  const getViewerGender = useCallback(() => {
    const g = (profile?.gender ?? profile?.orientation ?? '').toString().trim();
    return g ? g.toLowerCase() : '';
  }, [profile]);

  /** Helper: fetch a single date (robustly) and map to DateRow (same as feed rows). */
  const fetchSingleDateRow = useCallback(async (dateId: string): Promise<DateRow | null> => {
    // (a) try v2
    let base: any | null = null;
    try {
      const { data, error } = await supabase
        .from('vw_feed_dates_v2')
        .select(`
          id, creator, event_type, event_date, location, created_at,
          accepted_users, orientation_preference, spots, remaining_gender_counts,
          photo_urls, profile_photo, date_cover, creator_photo
        `)
        .eq('id', dateId)
        .limit(1);
      if (!error && Array.isArray(data) && data.length) base = data[0];
    } catch {/* ignore */}

    // (b) v1
    if (!base) {
      try {
        const { data, error } = await supabase
          .from('vw_feed_dates')
          .select(`
            id, creator, event_type, event_date, location, created_at,
            accepted_users, orientation_preference, spots, remaining_gender_counts,
            photo_urls, profile_photo
          `)
          .eq('id', dateId)
          .limit(1);
        if (!error && Array.isArray(data) && data.length) base = data[0];
      } catch {/* ignore */}
    }

    // (c) fallback from source tables
    if (!base) {
      try {
        const { data } = await supabase
          .from('date_requests')
          .select(`
            id, creator, event_type, event_date, location, created_at,
            orientation_preference, spots, remaining_gender_counts,
            photo_urls, profile_photo
          `)
          .eq('id', dateId)
          .limit(1);
        if (Array.isArray(data) && data.length) base = data[0];
      } catch {/* ignore */}
    }
    if (!base) {
      try {
        const { data } = await supabase
          .from('dates')
          .select(`
            id, creator, event_type, event_date, location, created_at,
            orientation_preference, spots, remaining_gender_counts,
            photo_urls, profile_photo
          `)
          .eq('id', dateId)
          .limit(1);
        if (Array.isArray(data) && data.length) base = data[0];
      } catch {/* ignore */}
    }
    if (!base) return null;

    // Enrich: who_pays + profiles
    let whoPays: string | null = null;
    try {
      const { data } = await supabase.from('date_requests').select('id, who_pays').eq('id', dateId).limit(1);
      if (Array.isArray(data) && data.length) whoPays = (data[0] as any).who_pays ?? null;
    } catch {/* ignore */}
    if (whoPays == null) {
      try {
        const { data } = await supabase.from('dates').select('id, who_pays').eq('id', dateId).limit(1);
        if (Array.isArray(data) && data.length) whoPays = (data[0] as any).who_pays ?? null;
      } catch {/* ignore */}
    }

    const creatorId = base.creator as string | undefined;
    const accIds: string[] = Array.isArray(base.accepted_users) ? base.accepted_users : [];

    let creator_profile: ProfileHydrated | null = null;
    const acceptedMap = new Map<string, ProfileHydrated>();

    const toSelect = 'id, screenname, birthdate, gender, orientation, profile_photo, location, preferences';
    try {
      if (creatorId) {
        const { data } = await supabase.from('profiles').select(toSelect).in('id', [creatorId]);
        if (Array.isArray(data) && data.length) creator_profile = data[0] as any;
      }
      if (accIds.length) {
        const { data } = await supabase.from('profiles').select(toSelect).in('id', accIds);
        (data || []).forEach((p: any) => acceptedMap.set(p.id, p as ProfileHydrated));
      }
    } catch {/* ignore */}

    const cleanLoc = !looksLikeWKTOrHex(base.location)
      ? base.location
      : (creator_profile?.location ?? null);

    const cover: string | null =
      base.date_cover ||
      (Array.isArray(base.photo_urls) && base.photo_urls[0]) ||
      base.profile_photo ||
      base.creator_photo ||
      creator_profile?.profile_photo ||
      null;

    const photo_urls: string[] =
      Array.isArray(base.photo_urls) && base.photo_urls.length ? base.photo_urls : (cover ? [cover] : []);

    const accepted_profiles: ProfileHydrated[] | null =
      accIds.length ? accIds.map((id) => acceptedMap.get(id)).filter(Boolean) as ProfileHydrated[] : null;

    return {
      id: base.id,
      title: base.title ?? base.event_type ?? null,
      event_date: base.event_date ?? null,
      who_pays: whoPays ?? null,
      event_type: base.event_type ?? null,
      orientation_preference: Array.isArray(base.orientation_preference) ? base.orientation_preference : null,
      distance_miles: null,
      profile_photo: creator_profile?.profile_photo ?? base.profile_photo ?? null,
      photo_urls,
      creator_id: base.creator,
      creator_profile,
      accepted_profiles,
      created_at: base.created_at ?? null,
      latitude: null,
      longitude: null,
      location: cleanLoc,
      spots: base.spots ?? null,
      remaining_gender_counts: base.remaining_gender_counts ?? null,
    } as DateRow;
  }, []);

  /**
   * Try v2 view first (richer fields), fall back to v1 if unavailable or if any unknown-column error occurs.
   * Then enrich rows with creator/accepted profiles + who_pays from source table.
   */
  const fetchPage = useCallback(
    async (pageArg: number, _coords?: { lat: number; lng: number }) => {
      if (!canQuery) return { rows: [] as DateRow[], pageUsed: pageArg };

      const rangeFrom = (pageArg - 1) * PAGE_SIZE;
      const rangeTo = rangeFrom + PAGE_SIZE - 1;
      const nowIso = new Date().toISOString();

      // 1) Attempt v2
      let base: any[] = [];
      let usedV2 = false;
      try {
        const { data, error } = await supabase
          .from('vw_feed_dates_v2')
          .select(`
            id, creator, event_type, event_date, location, created_at,
            accepted_users, orientation_preference, spots, remaining_gender_counts,
            photo_urls, profile_photo,
            date_cover, creator_photo, accepted_profile_photos
          `)
          .gte('event_date', nowIso)
          .neq('creator', userId!)
          .order('event_date', { ascending: true })
          .range(rangeFrom, rangeTo);

        if (error) throw error;
        base = data ?? [];
        usedV2 = true;
      } catch {
        // 2) Fallback to v1
        const { data, error } = await supabase
          .from('vw_feed_dates')
          .select(`
            id, creator, event_type, event_date, location, created_at,
            accepted_users, orientation_preference, spots, remaining_gender_counts,
            photo_urls, profile_photo
          `)
          .gte('event_date', nowIso)
          .neq('creator', userId!)
          .order('event_date', { ascending: true })
          .range(rangeFrom, rangeTo);

        if (error) throw error;
        base = data ?? [];
        usedV2 = false;
      }

      if (!base.length) {
        return { rows: [], pageUsed: pageArg };
      }

      // Collect ids for enrichment
      const dateIds: string[] = base.map(r => r.id).filter(Boolean);
      const creatorIds = Array.from(new Set(base.map(r => r.creator))).filter(Boolean);
      const acceptedIds = Array.from(
        new Set(
          base.flatMap(r =>
            Array.isArray(r.accepted_users) ? r.accepted_users : []
          )
        )
      ).filter(Boolean);

      // 3) Enrich with creator profiles
      let creatorsById = new Map<string, ProfileHydrated>();
      if (creatorIds.length) {
        const { data: creators, error: cErr } = await supabase
          .from('profiles')
          .select('id, screenname, birthdate, gender, orientation, profile_photo, location, preferences')
          .in('id', creatorIds);
        if (!cErr && creators) {
          creatorsById = new Map((creators as ProfileHydrated[]).map((p) => [p.id, p]));
        }
      }

      // 4) Enrich with accepted profiles
      let acceptedById = new Map<string, ProfileHydrated>();
      if (acceptedIds.length) {
        const { data: accs, error: aErr } = await supabase
          .from('profiles')
          .select('id, screenname, birthdate, gender, orientation, profile_photo, location, preferences')
          .in('id', acceptedIds);
        if (!aErr && accs) {
          acceptedById = new Map((accs as ProfileHydrated[]).map((p) => [p.id, p]));
        }
      }

      // 5) who_pays
      let whoPaysById = new Map<string, string | null>();
      if (dateIds.length) {
        const { data: meta } = await supabase
          .from('date_requests')
          .select('id, who_pays')
          .in('id', dateIds);
        if (meta?.length) {
          whoPaysById = new Map(meta.map((r: any) => [r.id, r.who_pays ?? null]));
        }
      }

      // 6) Map to DateRow
      const mapped: DateRow[] = base.map((r: any) => {
        const creator_profile = creatorsById.get(r.creator) ?? null;

        const cleanLoc = !looksLikeWKTOrHex(r.location)
          ? r.location
          : (creator_profile?.location ?? null);

        const cover: string | null = usedV2
          ? (r.date_cover ||
             (Array.isArray(r.photo_urls) && r.photo_urls[0]) ||
             r.profile_photo ||
             r.creator_photo ||
             creator_profile?.profile_photo ||
             null)
          : ((Array.isArray(r.photo_urls) && r.photo_urls[0]) ||
             r.profile_photo ||
             creator_profile?.profile_photo ||
             null);

        const photo_urls: string[] =
          Array.isArray(r.photo_urls) && r.photo_urls.length
            ? r.photo_urls
            : (cover ? [cover] : []);

        const accepted_profiles: ProfileHydrated[] | null = Array.isArray(r.accepted_users)
          ? r.accepted_users.map((uid: string) => acceptedById.get(uid)).filter(Boolean) as ProfileHydrated[]
          : null;

        return {
          id: r.id,
          title: r.title ?? r.event_type ?? null,
          event_date: r.event_date ?? null,
          who_pays: whoPaysById.get(r.id) ?? null,
          event_type: r.event_type ?? null,
          orientation_preference: Array.isArray(r.orientation_preference) ? r.orientation_preference : null,
          distance_miles: null,
          profile_photo: creator_profile?.profile_photo ?? r.profile_photo ?? null,
          photo_urls,
          creator_id: r.creator,
          creator_profile,
          accepted_profiles,
          created_at: r.created_at ?? null,
          latitude: null,
          longitude: null,
          location: cleanLoc,
          spots: r.spots ?? null,
          remaining_gender_counts: r.remaining_gender_counts ?? null,
        };
      });

      // 7) Client filters
      const filtered = mapped.filter((d) => {
        if (hiddenIds.has(String(d.id))) return false;

        const past = isPast(d);
        const full = isFull(d);

        const typeMatch =
          d.spots == null
            ? true
            : (selectedTypes.includes('group') && d.spots > 2) ||
              (selectedTypes.includes('one-on-one') && d.spots === 2);

        let withinRadius = true;
        if (d.distance_miles != null && radius !== 'All' && radius !== 'Nationwide') {
          const r = parseFloat(radius);
          if (!Number.isNaN(r)) withinRadius = Number(d.distance_miles) <= r;
        }

        const locationMatch =
          !filterText ||
          (typeof d.location === 'string' &&
            d.location.toLowerCase().includes(filterText.toLowerCase()));

        if (!typeMatch || !withinRadius || !locationMatch) return false;

        if (dateStateFilter === 'Available Dates' && full) return false;
        if (dateStateFilter === 'Filled Dates' && !full) return false;
        if (dateStateFilter === 'Passed Dates' && !past) return false;

        return true;
      });

      // 8) Sort
      const sorted = [...filtered].sort((a, b) => {
        const aDate = a.event_date ? +new Date(a.event_date) : 0;
        const bDate = b.event_date ? +new Date(b.event_date) : 0;
        const aDist = a.distance_miles ?? Number.POSITIVE_INFINITY;
        const bDist = b.distance_miles ?? Number.POSITIVE_INFINITY;
        const rank = (x: DateRow) => (isFull(x) ? 2 : isPast(x) ? 3 : 1);

        if (sortBy === 'Upcoming') return rank(a) - rank(b) || aDate - bDate || aDist - bDist;
        if (sortBy === 'Distance') return rank(a) - rank(b) || aDist - bDist || aDate - bDate;
        if (sortBy === 'Newest') return (+new Date(b.created_at || 0)) - (+new Date(a.created_at || 0));
        if (sortBy === 'Oldest') return (+new Date(a.created_at || 0)) - (+new Date(b.created_at || 0));
        return 0;
      });

      if (__DEV__) {
        console.debug(`[DateFeed] fetched=${base.length} afterFilters=${sorted.length}`);
      }
      return { rows: sorted, pageUsed: pageArg };
    },
    [canQuery, userId, profile, radius, filterText, sortBy, dateStateFilter, selectedTypes, hiddenIds, getViewerGender]
  );

  const refreshList = useCallback(
    async (_coordsOverride?: { lat: number; lng: number }) => {
      if (!canQuery) return;
      try {
        onEndReachedOkRef.current = false;
        setRefreshing(true);
        setRpcError(null);
        const { rows } = await fetchPage(1);
        setDates(rows);
        setPage(2);
        setHasMore(rows.length === PAGE_SIZE);
        setFirstLoadDone(true);
      } catch (e: any) {
        console.error('[DateFeed] refresh error', e?.message || e);
        setRpcError('We had trouble loading dates. Pull to refresh to try again.');
      } finally {
        setLoadingInitial(false);
        setRefreshing(false);
        setFetchingMore(false);
      }
    },
    [canQuery, fetchPage]
  );
  useEffect(() => { refreshListRef.current = refreshList; }, [refreshList]);

  const loadMore = useCallback(async () => {
    if (!canQuery || fetchingMore || !hasMore) return;
    try {
      setFetchingMore(true);
      const { rows } = await fetchPage(page);
      setDates(prev => [...prev, ...rows]);
      if (rows.length === PAGE_SIZE) setPage(prev => prev + 1);
      else setHasMore(false);
    } catch (e) {
      console.error('[DateFeed] loadMore error]', e);
    } finally {
      setFetchingMore(false);
    }
  }, [canQuery, fetchPage, page, hasMore, fetchingMore]);

  // Initial load when ready
  useEffect(() => {
    if (filtersLoaded && userId && profile) {
      setHasMore(true);
      setPage(1);
      refreshList();
    }
  }, [filtersLoaded, userId, profile, refreshList]);

  // Auto-refresh when screen regains focus
  useFocusEffect(
    useCallback(() => {
      if (userId && profile) {
        setHasMore(true);
        setPage(1);
        refreshList();
      }
    }, [userId, profile, refreshList])
  );

  // ===== Not Interested handler (also clears pinned if it matches) =====
  const onNotInterested = useCallback(async (dateId: string) => {
    if (!userId) return;
    setPinned((p) => (p?.id && String(p.id) === String(dateId) ? null : p));
    setDates(prev => prev.filter(d => String(d.id) !== String(dateId)));
    const next = new Set(hiddenIds);
    next.add(String(dateId));
    setHiddenIds(next);
    saveHidden(userId, next);
    try {
      const { error } = await supabase.from('user_hidden_dates').upsert(
        { user_id: userId, date_id: dateId },
        { onConflict: 'user_id,date_id' }
      );
      if (error) console.warn('[NotInterested] upsert warning:', error);
    } catch (err) {
      console.warn('[NotInterested] upsert failed:', err);
    }
  }, [userId, hiddenIds, saveHidden]);

  // ===== Invite consumption → PIN & SCROLL immediately =====
  const handledInviteRef = useRef(false);
  const ensurePinnedVisible = useCallback(async (dateId: string) => {
    // If already in the list, lift to the top; otherwise fetch and inject
    let row = dates.find((d) => String(d.id) === String(dateId)) || null;
    if (!row) row = await fetchSingleDateRow(String(dateId));
    if (!row) return;

    setPinned(row);
    setDates((prev) => [row!, ...prev.filter((d) => String(d.id) !== String(row!.id))]);

    // Scroll to top so the user sees it "pop"
    setTimeout(() => {
      try { flatListRef.current?.scrollToIndex({ index: 0, animated: true }); } catch {}
    }, 120);
  }, [dates, fetchSingleDateRow]);

  useEffect(() => {
    if (!userId || !profile || handledInviteRef.current) return;
    handledInviteRef.current = true;
    (async () => {
      try {
        const res = await consumePendingInviteAfterLogin(); // creates join_request if needed
        const dateId = res?.date_id || res?.dateId || (res as any)?.date?.id;
        if (dateId) await ensurePinnedVisible(String(dateId));
      } catch (e) {
        // harmless if service not available or nothing pending
      }
    })();
  }, [userId, profile, ensurePinnedVisible]);

  // ===== Places autocomplete =====
  useEffect(() => {
    const q = debouncedQuery?.trim();
    if (!hasPlaces) { setSuggestions([]); setOpenDropdown(false); return; }
    if (!q || q.length < 3) { setSuggestions([]); setOpenDropdown(false); return; }
    let cancelled = false;
    (async () => {
      try {
        setLoadingSuggest(true);
        const url =
          `${AUTOCOMPLETE_ENDPOINT}?input=${encodeURIComponent(q)}&types=(cities)&key=${GOOGLE_KEY}&sessiontoken=${sessionToken}`;
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;

        if (json?.status === 'OK' && Array.isArray(json?.predictions)) {
          const items: Suggestion[] = json.predictions.map((p: any) => ({
            description: p.description,
            place_id: p.place_id,
          }));
          setSuggestions(items);
          setOpenDropdown(items.length > 0);
        } else {
          setSuggestions([]);
          setOpenDropdown(false);
        }
      } catch {
        setSuggestions([]);
        setOpenDropdown(false);
      } finally {
        if (!cancelled) setLoadingSuggest(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedQuery, sessionToken, hasPlaces]);

  const resolvePlaceDetails = useCallback(async (place_id: string, label: string) => {
    if (!hasPlaces) return;
    try {
      const url = `${DETAILS_ENDPOINT}?place_id=${encodeURIComponent(place_id)}&fields=geometry,name&key=${GOOGLE_KEY}&sessiontoken=${sessionToken}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json?.status === 'OK' && json?.result?.geometry?.location) {
        const { lat, lng } = json.result.geometry.location;
        setOverrideCoords({ lat, lng });
        setLocationName(label);
        await AsyncStorage.setItem('locationName', label);
        await persistFilters();
        if (userId && profile) refreshListRef.current?.({ lat, lng });
      }
    } catch {
      // ignore
    }
  }, [persistFilters, profile, sessionToken, hasPlaces, userId]);

  // ===== Robust navigation helper for the New Date footer tab =====
  const goToCreateDateTab = useCallback(() => {
    const looksLikeCreateTab = (name: string) => {
      const n = name.toLowerCase().replace(/[\s_-]/g, '');
      return ['newdate', 'createdate', 'new', 'create', 'createdatetab', 'newdatetab'].includes(n);
    };
    let nav: any = navigation;
    for (let i = 0; i < 5 && nav; i++) {
      const state = nav?.getState?.();
      const routeNames: string[] = Array.isArray(state?.routeNames) ? state.routeNames : [];
      const match = routeNames.find(looksLikeCreateTab);
      if (match) {
        try { nav.navigate(match as never); return; } catch {}
        try { nav.navigate(match as never, { screen: 'CreateDateScreen' } as never); return; } catch {}
      }
      nav = nav?.getParent?.();
    }
    const FALLBACKS = [
      { name: 'New Date' }, { name: 'NewDate' }, { name: 'CreateDate' },
      { name: 'Create Date' }, { name: 'NewDateTab' }, { name: 'CreateDateTab' },
      { name: 'CreateDateScreen' },
    ];
    for (const f of FALLBACKS) {
      try { navigation.dispatch(CommonActions.navigate({ name: f.name as any })); return; } catch {}
      try { navigation.navigate(f.name as never); return; } catch {}
    }
  }, [navigation]);

  // ===== Header Filters =====
  const FiltersPanel = (
    <View style={[styles.filterPanelOuter, { paddingTop: insets.top + 6 }]}>
      <TouchableOpacity
        onPress={() => { Keyboard.dismiss(); setShowFilters((s) => !s); }}
        activeOpacity={0.8}
        style={styles.filterToggle}
      >
        <Text style={styles.toggle}>
          {showFilters ? 'Hide Filters ▲' : 'Show Filters ▼'}
        </Text>
      </TouchableOpacity>

      {showFilters && (
        <View style={styles.filterPanel}>
          {/* Location */}
          <Text style={styles.label}>📍 Location</Text>

          {/* Use My Current Location */}
          <TouchableOpacity style={styles.currentLocBtn} onPress={getCurrentLocation} activeOpacity={0.9}>
            <Text style={styles.currentLocText}>Use My Current Location</Text>
          </TouchableOpacity>

          {/* City input + dropdown */}
          <View style={{ position: 'relative', zIndex: 50, marginTop: 8 }}>
            <TextInput
              style={styles.input}
              placeholder="Enter city (e.g., Santa Monica)"
              value={locationName}
              onChangeText={(t) => {
                setLocationName(t);
                if (t.trim().length >= 3) setOpenDropdown(true);
                if (t.trim().length === 0) {
                  setSuggestions([]); setOpenDropdown(false); setOverrideCoords(null);
                }
              }}
              placeholderTextColor="#8A94A6"
              onFocus={() => { if (suggestions.length > 0) setOpenDropdown(true); }}
              onBlur={() => setTimeout(() => setOpenDropdown(false), 100)}
              returnKeyType="done"
              autoCapitalize="words"
              autoCorrect={false}
            />

            {/* Autocomplete dropdown */}
            {openDropdown && (
              <View style={styles.dropdown}>
                {loadingSuggest ? (
                  <View style={styles.dropdownItem}>
                    <ActivityIndicator />
                    <Text style={{ marginLeft: 8, color: '#6b7280' }}>Searching cities…</Text>
                  </View>
                ) : suggestions.length === 0 ? (
                  <View style={styles.dropdownItem}>
                    <Text style={{ color: '#6b7280' }}>No matches</Text>
                  </View>
                ) : (
                  <FlatList
                    keyboardShouldPersistTaps="handled"
                    data={suggestions}
                    keyExtractor={(item) => item.place_id}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.dropdownItem}
                        activeOpacity={0.85}
                        onPress={() => {
                          setOpenDropdown(false); setSuggestions([]);
                          resolvePlaceDetails(item.place_id, item.description);
                        }}
                      >
                        <Text style={{ color: '#111827' }}>{item.description}</Text>
                      </TouchableOpacity>
                    )}
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                  />
                )}
              </View>
            )}
          </View>

          {/* Distance */}
          <Text style={[styles.label, { marginTop: 12 }]}>📏 Distance</Text>
          <View style={styles.chipRowWrap}>
            {['10', '25', '50', '100', '150', '250', 'Nationwide', 'All'].map((item) => {
              const active = radius === item;
              return (
                <TouchableOpacity
                  key={item}
                  onPress={async () => { setRadius(item); await persistFilters(); refreshList(); }}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.85}
                >
                  <Text style={active ? styles.chipTextActive : styles.chipText}>
                    {item}{/^\d+$/.test(item) ? ' mi' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Status */}
          <Text style={[styles.label, { marginTop: 12 }]}>Status</Text>
          <View style={styles.chipRowWrap}>
            {stateOptions.map((opt) => {
              const active = dateStateFilter === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={async () => { setDateStateFilter(opt); await persistFilters(); refreshList(); }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={active ? styles.chipTextActive : styles.chipText}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Type */}
          <Text style={[styles.label, { marginTop: 12 }]}>Type</Text>
          <View style={styles.chipRowWrap}>
            {typeOptions.map((opt) => {
              const active = selectedTypes.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={async () => {
                    const next = active ? selectedTypes.filter(t => t !== opt) : [...selectedTypes, opt];
                    setSelectedTypes(next); await persistFilters(); refreshList();
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={active ? styles.chipTextActive : styles.chipText}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Sort */}
          <Text style={[styles.label, { marginTop: 12 }]}>Sort By</Text>
          <View style={styles.chipRowWrap}>
            {sortOptions.map((opt) => {
              const active = sortBy === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={async () => { setSortBy(opt); await persistFilters(); refreshList(); }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={active ? styles.chipTextActive : styles.chipText}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );

  // ===== List footer =====
  const ListFooter = useMemo(() => {
    if (fetchingMore) {
      return (<View style={{ paddingVertical: 12 }}><ActivityIndicator /></View>);
    }
    if (!hasMore && dates.length > 0) {
      return (<View><Text style={{ textAlign: 'center', padding: 12, color: 'gray' }}>No more results</Text></View>);
    }
    return null;
  }, [fetchingMore, hasMore, dates.length]);

  // ===== Deep-link scroll (param) =====
  const lastHandledIdRef = useRef<string | undefined>(undefined);
  const tryScrollToId = useCallback(
    (id?: string) => {
      if (!id) return;
      const full = (pinned ? [pinned, ...dates.filter(d => d.id !== pinned.id)] : dates);
      if (!full.length) return;
      if (lastHandledIdRef.current === id) return;
      const index = full.findIndex((d) => String(d.id) === String(id));
      if (index !== -1) {
        flatListRef.current?.scrollToIndex({ index, animated: true });
        lastHandledIdRef.current = id;
        if (route.params?.scrollToDateId) navigation.setParams({ scrollToDateId: undefined } as any);
      }
    }, [dates, pinned, navigation, route.params]
  );

  useFocusEffect(
    useCallback(() => {
      const id = route.params?.scrollToDateId;
      if (!loadingInitial && !refreshing) tryScrollToId(id);
    }, [route.params?.scrollToDateId, loadingInitial, refreshing, tryScrollToId])
  );

  // --- Render data (prepend pinned if present) ---
  const listData = useMemo(
    () => (pinned ? [pinned, ...dates.filter((d) => d.id !== pinned.id)] : dates),
    [pinned, dates]
  );

  // --- UI ---
  return (
    <AnimatedScreenWrapper showLogo={false} {...({ style: { backgroundColor: '#FFFFFF' } } as any)}>
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        {FiltersPanel}

        <FlatList
          ref={flatListRef}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 8 }}
          data={listData}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <DateCard
              date={item}
              userId={userId ?? ''}
              isCreator={item.creator_id === userId}
              isAccepted={false}
              disabled={false}
              onPressProfile={(pid) => navigation.navigate('PublicProfile', { userId: pid, origin: 'DateFeed' } as any)}
              onPressCard={() => {/* hook for details */}}
              onNotInterested={() => onNotInterested(String(item.id))}
            />
          )}
          removeClippedSubviews={false}
          windowSize={10}
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={60}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshList()} />}
          onEndReached={() => {
            if (!onEndReachedOkRef.current) return;
            if (!loadingInitial && !refreshing && hasMore && !fetchingMore) loadMore();
          }}
          onEndReachedThreshold={0.4}
          onMomentumScrollBegin={() => { onEndReachedOkRef.current = true; }}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => flatListRef.current?.scrollToIndex({ index: info.index, animated: true }), 250);
          }}
          ListFooterComponent={ListFooter}
          ListEmptyComponent={
            firstLoadDone && !loadingInitial && !refreshing
              ? (
                <View style={{ width: '100%', alignItems: 'center', padding: 24 }}>
                  {!userId ? (
                    <>
                      <Text style={{ fontSize: 16, fontWeight: '500', marginBottom: 10, textAlign: 'center' }}>
                        You’re signed out. Log in to see dates.
                      </Text>
                      <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.primaryBtn}>
                        <Text style={styles.primaryBtnText}>Log In</Text>
                      </TouchableOpacity>
                    </>
                  ) : rpcError ? (
                    <>
                      <Text style={{ fontSize: 16, fontWeight: '500', marginBottom: 10, textAlign: 'center' }}>
                        {rpcError}
                      </Text>
                      <TouchableOpacity onPress={() => refreshList()} style={styles.primaryBtn}>
                        <Text style={styles.primaryBtnText}>Retry</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={{ fontSize: 16, fontWeight: '500', marginBottom: 10, textAlign: 'center' }}>
                        There are no dates nearby — yet. Be a pioneer and create one!
                        {'\n'}From one‑on‑one dinners to poker nights, concerts, or a classy yacht party —
                        your invite could spark the next great connection.
                      </Text>
                      <TouchableOpacity onPress={goToCreateDateTab} style={styles.primaryBtn}>
                        <Text style={styles.primaryBtnText}>+ Create Date</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ) : null
          }
        />
      </View>
    </AnimatedScreenWrapper>
  );
}

const styles = StyleSheet.create({
  // Filter panel
  filterPanelOuter: { backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  filterToggle: { paddingVertical: 8, alignItems: 'flex-start' },
  toggle: { fontSize: 14, fontWeight: '600', color: DRYNKS_RED },
  filterPanel: { backgroundColor: DRYNKS_GRAY, padding: 12, borderRadius: 12, marginTop: 10 },
  label: { fontSize: 12, fontWeight: '600', marginTop: 4, color: DRYNKS_BLUE },

  currentLocBtn: {
    marginTop: 6, borderWidth: 1, borderColor: '#DADFE6', backgroundColor: '#fff',
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center',
  },
  currentLocText: { color: DRYNKS_BLUE, fontWeight: '700' },

  // Places dropdown
  input: {
    height: 50, borderColor: '#DADFE6', borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, marginTop: 8, fontSize: 16, backgroundColor: '#fff', color: '#1F2A33',
  },
  dropdown: {
    position: 'absolute', top: 58, left: 0, right: 0, backgroundColor: '#fff',
    borderColor: '#E5E7EB', borderWidth: 1, borderRadius: 10, overflow: 'hidden',
    zIndex: 1000, maxHeight: 240, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  dropdownItem: { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center' },
  separator: { height: 1, backgroundColor: '#F3F4F6' },

  // Chips
  chipRowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  chip: { backgroundColor: '#ddd', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: DRYNKS_BLUE },
  chipText: { fontSize: 12, color: '#333' },
  chipTextActive: { fontSize: 12, color: '#fff', fontWeight: '600' },

  // Buttons
  primaryBtn: { backgroundColor: DRYNKS_RED, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  primaryBtnText: { color: 'white', fontWeight: '700' },
});
