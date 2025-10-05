// Date Feed — production-ready, tolerant to both vw_feed_dates_v2 and vw_feed_dates
// FIXES:
//  - Fall back to base table (date_requests) if views are missing.
//  - Do NOT apply the "location text includes" filter when we have coordinates + radius.
//  - Exclude my own posts (creator != me) at the query level for all sources.
//  - If viewer is Female, require female slots > 0 (configurable below).
//  - Keep creator/accepted profile hydration + who_pays & lat/lng hydration.
//  - Invite-link pinning + robust places autocomplete remain intact.
//  - **NEW:** De-dupe feed items by id (render + state) to eliminate duplicate keys.

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from 'react';
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
import {
  useFocusEffect,
  CommonActions,
  type RouteProp,
} from '@react-navigation/native';
import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';

import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import DateCard from '@components/cards/DateCard';
import { tryPromptIfArmed } from '@services/QuickUnlockService';
import { supabase } from '@config/supabase';
import { consumePendingInviteAfterLogin } from '@services/InviteLinks';
import {
  GOOGLE_PLACES_KEY as GOOGLE_KEY,
  HAS_PLACES,
  PLACES_COUNTRIES,
} from '@config/env';

import type { RootStackParamList } from '../../types/navigation';

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
  profile_photo: string | null;
  photo_urls: string[];
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

// Optional behavior: if the viewer is Female, require female slots > 0
const REQUIRE_FEMALE_SLOT_WHEN_VIEWER_IS_FEMALE = true;

// --- Google Places
type Suggestion = { description: string; place_id: string };
const AUTOCOMPLETE_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/details/json';
const FINDPLACE_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
const GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

// ===== Types for screen props (matches AppNavigator's wrapper) =====
type ScreenProps = NativeStackScreenProps<RootStackParamList, 'DateFeed'> & {
  scrollToDateId?: string;
};

// ---- Helpers
const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const hiddenKeyFor = (uid: string) => `hidden_dates_v1:${uid}`;

// De-dupe helpers
const uniqueById = (arr: DateRow[]): DateRow[] => {
  const map = new Map<string, DateRow>();
  for (const r of arr) {
    const id = String(r?.id ?? '');
    if (!id) continue;
    if (!map.has(id)) map.set(id, r);
  }
  return [...map.values()];
};

const DateFeedScreen: React.FC<ScreenProps> = (props) => {
  const { navigation, route, scrollToDateId } = props;
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<DateRow>>(null);

  // --- auth/profile ---
  const [userId, setUserId] = useState<UUID | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // --- data ---
  const [dates, setDates] = useState<DateRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // pinned (invite)
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
  const [filterText, setFilterText] = useState(''); // stays in sync with locationName
  const [sortBy, setSortBy] =
    useState<(typeof sortOptions)[number]>('Upcoming');
  const [dateStateFilter, setDateStateFilter] =
    useState<(typeof stateOptions)[number]>('All');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    'group',
    'one-on-one',
  ]);
  const [locationName, setLocationName] = useState('');
  const [overrideCoords, setOverrideCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Suggestions state
  const [sessionToken] = useState<string>(uuidv4());
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(false);

  const debouncedQuery = useDebouncedValue(locationName, 250);
  const hasPlaces = HAS_PLACES;
  const didInitLocationRef = useRef(false);

  // Keep the coordinates used for pagination consistent
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

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
    if (map.dateStateFilter)
      setDateStateFilter(map.dateStateFilter as (typeof stateOptions)[number]);
    if (map.selectedTypes) setSelectedTypes(JSON.parse(map.selectedTypes));
    if (map.locationName) {
      setLocationName(map.locationName);
      didInitLocationRef.current = true;
    }
    setFiltersLoaded(true);
  }, []);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  // Hidden cache
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
      await AsyncStorage.setItem(
        hiddenKeyFor(uid),
        JSON.stringify(Array.from(nextSet))
      );
    } catch {
      // no-op
    }
  }, []);

  // ----- geocode helpers -----
  const reverseGeocodeToCity = useCallback(async (lat: number, lng: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });
      const city =
        results?.[0]?.city ||
        results?.[0]?.subregion ||
        results?.[0]?.region;
      if (city) {
        setLocationName(city);
        setFilterText(city); // keep in sync for string filter
        await AsyncStorage.multiSet([
          ['locationName', city],
          ['filterText', city],
        ]);
      }
    } catch {
      // ignore
    }
  }, []);

  // Debounce helper hook
  function useDebouncedValue<T>(value: T, delay = 250) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
      const id = setTimeout(() => setDebounced(value), delay);
      return () => clearTimeout(id);
    }, [value, delay]);
    return debounced;
  }

  const refreshListRef = useRef<
    null | ((coords?: { lat: number; lng: number }) => Promise<void>)
  >(null);

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
      if (userId && profile)
        refreshListRef.current?.({
          lat: coords.latitude,
          lng: coords.longitude,
        });
    } catch {
      Alert.alert('Location Error', 'Could not fetch your location.');
    }
  }, [persistFilters, profile, reverseGeocodeToCity, userId]);

  // ----- session/profile hydrate -----
  const hydrateSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      setUserId(null);
      setProfile(null);
      setDates([]);
      setPinned(null);
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
      .select(
        'id, gender, orientation, latitude, longitude, location, profile_photo'
      )
      .eq('id', uid)
      .single();

    if (prof) {
      setProfile(prof as Profile);
      if (!didInitLocationRef.current) {
        if ((prof as Profile).location) {
          setLocationName((prof as Profile).location as string);
          setFilterText((prof as Profile).location as string);
          await AsyncStorage.multiSet([
            ['locationName', (prof as Profile).location as string],
            ['filterText', (prof as Profile).location as string],
          ]);
          didInitLocationRef.current = true;
        } else if (
          (prof as Profile).latitude != null &&
          (prof as Profile).longitude != null
        ) {
          await reverseGeocodeToCity(
            (prof as Profile).latitude!,
            (prof as Profile).longitude!
          );
          didInitLocationRef.current = true;
        }
      }
    }
  }, [loadHidden, reverseGeocodeToCity]);

  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      hydrateSession();
    });
    return () => subscription.unsubscribe();
  }, [hydrateSession]);

  // ======= QuickUnlock prompt =======
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

  // ======= FETCHING & DISTANCE =======
  const canQuery = useMemo(() => !!userId && !!profile, [userId, profile]);

  const isPast = (d: DateRow) => {
    if (!d?.event_date) return false;
    const dt = new Date(d.event_date);
    return !Number.isNaN(+dt) && dt < new Date();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };
  const isFull = (d: DateRow) => {
    const rgc = d.remaining_gender_counts;
    if (!rgc || typeof rgc !== 'object') return false;
    const vals = Object.values(rgc).filter((v) => typeof v === 'number');
    if (vals.length === 0) return false;
    return vals.every((v) => v === 0);
  };

  // Pull lat/lng for missing rows from date_requests
  const hydrateLatLng = useCallback(
    async (
      ids: string[],
      existing: Map<string, { lat: number | null; lng: number | null }>
    ) => {
      const missing = ids.filter((id) => !existing.has(id));
      if (!missing.length) return existing;
      try {
        const { data } = await supabase
          .from('date_requests')
          .select('id, latitude, longitude')
          .in('id', missing);
        (data || []).forEach((r: any) => {
          const lat = typeof r.latitude === 'number' ? r.latitude : null;
          const lng = typeof r.longitude === 'number' ? r.longitude : null;
          existing.set(r.id, { lat, lng });
        });
      } catch {
        // ignore
      }
      return existing;
    },
    []
  );

  /** Helper: fetch a single date and map (for pinning) */
  const fetchSingleDateRow = useCallback(
    async (dateId: string): Promise<DateRow | null> => {
      let base: any | null = null;
      try {
        const { data, error } = await supabase
          .from('vw_feed_dates_v2')
          .select(
            `
          id, title, creator, event_type, event_date, location, created_at,
          accepted_users, orientation_preference, spots, remaining_gender_counts,
          photo_urls, profile_photo, date_cover, creator_photo, latitude, longitude
        `
          )
          .eq('id', dateId)
          .limit(1);
        if (!error && Array.isArray(data) && data.length) base = data[0];
      } catch {
        // ignore
      }
      if (!base) {
        try {
          const { data, error } = await supabase
            .from('vw_feed_dates')
            .select(
              `
            id, title, creator, event_type, event_date, location, created_at,
            accepted_users, orientation_preference, spots, remaining_gender_counts,
            photo_urls, profile_photo, latitude, longitude
          `
            )
            .eq('id', dateId)
            .limit(1);
          if (!error && Array.isArray(data) && data.length) base = data[0];
        } catch {
          // ignore
        }
      }
      if (!base) {
        try {
          const { data } = await supabase
            .from('date_requests')
            .select(
              `
            id, title, creator, event_type, event_date, location, created_at,
            latitude, longitude,
            orientation_preference, spots, remaining_gender_counts,
            photo_urls, profile_photo
          `
            )
            .eq('id', dateId)
            .limit(1);
          if (Array.isArray(data) && data.length) base = data[0];
        } catch {
          // ignore
        }
      }
      if (!base) return null;

      let whoPays: string | null = null;
      try {
        const { data } = await supabase
          .from('date_requests')
          .select('id, who_pays')
          .eq('id', dateId)
          .limit(1);
        if (Array.isArray(data) && data.length)
          whoPays = (data[0] as any).who_pays ?? null;
      } catch {
        // ignore
      }
      if (whoPays == null) {
        try {
          const { data } = await supabase
            .from('dates')
            .select('id, who_pays')
            .eq('id', dateId)
            .limit(1);
          if (Array.isArray(data) && data.length)
            whoPays = (data[0] as any).who_pays ?? null;
        } catch {
          // ignore
        }
      }

      const creatorId = base.creator as string | undefined;
      const accIds: string[] = Array.isArray(base.accepted_users)
        ? base.accepted_users
        : [];

      let creator_profile: ProfileHydrated | null = null;
      const acceptedMap = new Map<string, ProfileHydrated>();
      const toSelect =
        'id, screenname, birthdate, gender, orientation, profile_photo, location, preferences';
      try {
        if (creatorId) {
          const { data } = await supabase
            .from('profiles')
            .select(toSelect)
            .in('id', [creatorId]);
          if (Array.isArray(data) && data.length)
            creator_profile = data[0] as any;
        }
        if (accIds.length) {
          const { data } = await supabase
            .from('profiles')
            .select(toSelect)
            .in('id', accIds);
          (data || []).forEach((p: any) =>
            acceptedMap.set(p.id, p as ProfileHydrated)
          );
        }
      } catch {
        // ignore
      }

      let lat: number | null =
        typeof base.latitude === 'number' ? base.latitude : null;
      let lng: number | null =
        typeof base.longitude === 'number' ? base.longitude : null;
      if ((lat == null || lng == null) && looksLikeWKTOrHex(base.location)) {
        const parsed = parseWktPoint(base.location);
        if (parsed) {
          lat = parsed.lat;
          lng = parsed.lng;
        }
      } else if (lat == null || lng == null) {
        try {
          const { data } = await supabase
            .from('date_requests')
            .select('latitude, longitude')
            .eq('id', dateId)
            .limit(1);
          if (Array.isArray(data) && data.length) {
            lat =
              typeof data[0].latitude === 'number' ? data[0].latitude : null;
            lng =
              typeof data[0].longitude === 'number' ? data[0].longitude : null;
          }
        } catch {
          // ignore
        }
      }

      const viewer =
        lastCoordsRef.current ||
        overrideCoords ||
        (profile?.latitude != null && profile?.longitude != null
          ? { lat: profile.latitude!, lng: profile.longitude! }
          : null);
      const distance =
        viewer && lat != null && lng != null
          ? milesBetween(viewer.lat, viewer.lng, lat, lng)
          : null;

      const cleanLoc = !looksLikeWKTOrHex(base.location)
        ? base.location
        : creator_profile?.location ?? null;

      const cover: string | null =
        base.date_cover ||
        (Array.isArray(base.photo_urls) && base.photo_urls[0]) ||
        base.profile_photo ||
        base.creator_photo ||
        creator_profile?.profile_photo ||
        null;

      const photo_urls: string[] =
        Array.isArray(base.photo_urls) && base.photo_urls.length
          ? base.photo_urls
          : cover
          ? [cover]
          : [];

      const accepted_profiles: ProfileHydrated[] | null = accIds.length
        ? (accIds
            .map((id) => acceptedMap.get(id))
            .filter(Boolean) as ProfileHydrated[])
        : null;

      return {
        id: base.id,
        title: base.title ?? base.event_type ?? null,
        event_date: base.event_date ?? null,
        who_pays: whoPays ?? null,
        event_type: base.event_type ?? null,
        orientation_preference: Array.isArray(base.orientation_preference)
          ? base.orientation_preference
          : null,
        distance_miles: distance,
        profile_photo:
          creator_profile?.profile_photo ?? base.profile_photo ?? null,
        photo_urls,
        creator_id: base.creator,
        creator_profile,
        accepted_profiles,
        created_at: base.created_at ?? null,
        latitude: lat,
        longitude: lng,
        location: cleanLoc,
        spots: base.spots ?? null,
        remaining_gender_counts: base.remaining_gender_counts ?? null,
      } as DateRow;
    },
    [overrideCoords, profile]
  );

  // Distance helpers
  const toRad = (x: number) => (x * Math.PI) / 180;
  function milesBetween(
    aLat?: number | null,
    aLng?: number | null,
    bLat?: number | null,
    bLng?: number | null
  ) {
    if (
      aLat == null ||
      aLng == null ||
      bLat == null ||
      bLng == null ||
      Number.isNaN(+aLat) ||
      Number.isNaN(+aLng) ||
      Number.isNaN(+bLat) ||
      Number.isNaN(+bLng)
    )
      return null;
    const R = 3958.7613; // miles
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLng - aLng);
    const la1 = toRad(aLat);
    const la2 = toRad(bLat);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  function parseWktPoint(s?: string | null): { lat: number; lng: number } | null {
    if (!s || !/^SRID=/i.test(s)) return null;
    const m = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(s);
    if (!m) return null;
    const lon = parseFloat(m[1]);
    const lat = parseFloat(m[2]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return { lat, lng: lon };
  }

  /**
   * Fetch a page; compute distance using coordsOverride or last known/viewer coords.
   * Fallback chain: vw_feed_dates_v2 -> vw_feed_dates -> date_requests
   */
  const fetchPage = useCallback(
    async (pageArg: number, coordsOverride?: { lat: number; lng: number }) => {
      if (!canQuery) return { rows: [] as DateRow[], pageUsed: pageArg };

      const viewer =
        coordsOverride ??
        lastCoordsRef.current ??
        overrideCoords ??
        (profile?.latitude != null && profile?.longitude != null
          ? { lat: profile.latitude!, lng: profile.longitude! }
          : null);

      lastCoordsRef.current = viewer || null;

      const rangeFrom = (pageArg - 1) * PAGE_SIZE;
      const rangeTo = rangeFrom + PAGE_SIZE - 1;
      const nowIso = new Date().toISOString();

      let base: any[] = [];
      // Try v2
      try {
        const { data, error } = await supabase
          .from('vw_feed_dates_v2')
          .select(
            `
            id, title, creator, event_type, event_date, location, created_at,
            accepted_users, orientation_preference, spots, remaining_gender_counts,
            photo_urls, profile_photo, date_cover, creator_photo, latitude, longitude
          `
          )
          .gte('event_date', nowIso)
          .neq('creator', userId!)
          .order('event_date', { ascending: true })
          .range(rangeFrom, rangeTo);
        if (error) throw error;
        base = data ?? [];
      } catch {
        // Try v1
        try {
          const { data, error } = await supabase
            .from('vw_feed_dates')
            .select(
              `
              id, title, creator, event_type, event_date, location, created_at,
              accepted_users, orientation_preference, spots, remaining_gender_counts,
              photo_urls, profile_photo, latitude, longitude
            `
            )
            .gte('event_date', nowIso)
            .neq('creator', userId!)
            .order('event_date', { ascending: true })
            .range(rangeFrom, rangeTo);
          if (error) throw error;
          base = data ?? [];
        } catch {
          // Fallback to base table
          const { data, error } = await supabase
            .from('date_requests')
            .select(
              `
              id, title, creator, event_type, event_date, location, created_at,
              accepted_users, orientation_preference, spots, remaining_gender_counts,
              photo_urls, profile_photo, latitude, longitude, status
            `
            )
            .eq('status', 'pending')
            .gte('event_date', nowIso)
            .neq('creator', userId!)
            .order('event_date', { ascending: true })
            .range(rangeFrom, rangeTo);
          if (error) throw error;
          base = data ?? [];
        }
      }

      if (!base.length) {
        return { rows: [], pageUsed: pageArg };
      }

      // Collect ids
      const dateIds: string[] = base.map((r) => r.id).filter(Boolean);
      const creatorIds = Array.from(
        new Set(base.map((r) => r.creator))
      ).filter(Boolean);
      const acceptedIds = Array.from(
        new Set(
          base.flatMap((r) =>
            Array.isArray(r.accepted_users) ? r.accepted_users : []
          )
        )
      ).filter(Boolean);

      // Hydrate profiles
      const creatorsById = new Map<string, ProfileHydrated>();
      if (creatorIds.length) {
        const { data: creators } = await supabase
          .from('profiles')
          .select(
            'id, screenname, birthdate, gender, orientation, profile_photo, location, preferences'
          )
          .in('id', creatorIds);
        (creators || []).forEach((p: any) =>
          creatorsById.set(p.id, p as ProfileHydrated)
        );
      }

      const acceptedById = new Map<string, ProfileHydrated>();
      if (acceptedIds.length) {
        const { data: accs } = await supabase
          .from('profiles')
          .select(
            'id, screenname, birthdate, gender, orientation, profile_photo, location, preferences'
          )
          .in('id', acceptedIds);
        (accs || []).forEach((p: any) =>
          acceptedById.set(p.id, p as ProfileHydrated)
        );
      }

      // who_pays
      const whoPaysById = new Map<string, string | null>();
      if (dateIds.length) {
        const { data: meta } = await supabase
          .from('date_requests')
          .select('id, who_pays')
          .in('id', dateIds);
        (meta || []).forEach((r: any) =>
          whoPaysById.set(r.id, r.who_pays ?? null)
        );
      }

      // lat/lng map (from WKT or additional fetch)
      const latLngById = new Map<
        string,
        { lat: number | null; lng: number | null }
      >();
      base.forEach((r: any) => {
        let lat: number | null =
          typeof r.latitude === 'number' ? r.latitude : null;
        let lng: number | null =
          typeof r.longitude === 'number' ? r.longitude : null;
        if ((lat == null || lng == null) && looksLikeWKTOrHex(r.location)) {
          const parsed = parseWktPoint(r.location);
          if (parsed) {
            lat = parsed.lat;
            lng = parsed.lng;
          }
        }
        if (lat != null || lng != null) latLngById.set(r.id, { lat, lng });
      });
      await hydrateLatLng(dateIds, latLngById);

      // Map to DateRow + compute distance
      const mapped: DateRow[] = base.map((r: any) => {
        const creator_profile = creatorsById.get(r.creator) ?? null;

        const cleanLoc = !looksLikeWKTOrHex(r.location)
          ? r.location
          : creator_profile?.location ?? null;

        const cover: string | null =
          r.date_cover ||
          (Array.isArray(r.photo_urls) && r.photo_urls[0]) ||
          r.profile_photo ||
          creator_profile?.profile_photo ||
          null;

        const photo_urls: string[] =
          Array.isArray(r.photo_urls) && r.photo_urls.length
            ? r.photo_urls
            : cover
            ? [cover]
            : [];

        const accepted_profiles: ProfileHydrated[] | null = Array.isArray(
          r.accepted_users
        )
          ? (r.accepted_users
              .map((uid: string) => acceptedById.get(uid))
              .filter(Boolean) as ProfileHydrated[])
          : null;

        const latlng = latLngById.get(r.id) ?? { lat: null, lng: null };
        const distance =
          viewer && latlng.lat != null && latlng.lng != null
            ? milesBetween(viewer.lat, viewer.lng, latlng.lat, latlng.lng)
            : null;

        return {
          id: r.id,
          title: r.title ?? r.event_type ?? null,
          event_date: r.event_date ?? null,
          who_pays: whoPaysById.get(r.id) ?? null,
          event_type: r.event_type ?? null,
          orientation_preference: Array.isArray(r.orientation_preference)
            ? r.orientation_preference
            : null,
          distance_miles: distance,
          profile_photo:
            creator_profile?.profile_photo ?? r.profile_photo ?? null,
          photo_urls,
          creator_id: r.creator,
          creator_profile,
          accepted_profiles,
          created_at: r.created_at ?? null,
          latitude: latlng.lat,
          longitude: latlng.lng,
          location: cleanLoc,
          spots: r.spots ?? null,
          remaining_gender_counts: r.remaining_gender_counts ?? null,
        };
      });

      // Client filters
      const viewerCoords =
        lastCoordsRef.current ||
        overrideCoords ||
        (profile?.latitude != null && profile?.longitude != null
          ? { lat: profile.latitude!, lng: profile.longitude! }
          : null);

      const mustUseTextFilter =
        !viewerCoords || radius === 'Nationwide' || radius === 'All';

      const locationTerm = (locationName || filterText || '').trim();

      const requireFemaleSlot =
        REQUIRE_FEMALE_SLOT_WHEN_VIEWER_IS_FEMALE &&
        (profile?.gender || '').toLowerCase() === 'female';

      const filtered = mapped.filter((d) => {
        if (hiddenIds.has(String(d.id))) return false;

        const past = isPast(d);
        const full = isFull(d);

        // Optionally require a female slot if viewer is female
        if (requireFemaleSlot) {
          const femaleLeft = Number(
            (d.remaining_gender_counts as any)?.Female ?? 0
          );
          if (Number.isFinite(femaleLeft) && femaleLeft <= 0) return false;
        }

        const typeMatch =
          d.spots == null
            ? true
            : (selectedTypes.includes('group') && d.spots > 2) ||
              (selectedTypes.includes('one-on-one') && d.spots === 2);

        let withinRadius = true;
        if (
          d.distance_miles != null &&
          radius !== 'All' &&
          radius !== 'Nationwide'
        ) {
          const rmi = parseFloat(radius);
          if (!Number.isNaN(rmi)) withinRadius = Number(d.distance_miles) <= rmi;
        }

        // Only apply string "location contains" when we lack coords OR user chose Nationwide/All
        const locationMatch =
          !mustUseTextFilter ||
          !locationTerm ||
          (typeof d.location === 'string' &&
            d.location.toLowerCase().includes(locationTerm.toLowerCase()));

        // basic orientation sanity (if present)
        const orient = Array.isArray(d.orientation_preference)
          ? d.orientation_preference
          : [];
        const orientationOK =
          orient.length === 0 ||
          orient.includes('Everyone') ||
          orient.includes('Straight');

        if (!typeMatch || !withinRadius || !locationMatch || !orientationOK)
          return false;

        if (dateStateFilter === 'Available Dates' && full) return false;
        if (dateStateFilter === 'Filled Dates' && !full) return false;
        if (dateStateFilter === 'Passed Dates' && !past) return false;

        return true;
      });

      // Sort
      const sorted = [...filtered].sort((a, b) => {
        const aDate = a.event_date ? +new Date(a.event_date) : 0;
        const bDate = b.event_date ? +new Date(b.event_date) : 0;
        const aDist = a.distance_miles ?? Number.POSITIVE_INFINITY;
        const bDist = b.distance_miles ?? Number.POSITIVE_INFINITY;
        const rank = (x: DateRow) => (isFull(x) ? 2 : isPast(x) ? 3 : 1);

        if (sortBy === 'Upcoming')
          return rank(a) - rank(b) || aDate - bDate || aDist - bDist;
        if (sortBy === 'Distance')
          return rank(a) - rank(b) || aDist - bDist || aDate - bDate;
        if (sortBy === 'Newest')
          return +new Date(b.created_at || 0) - +new Date(a.created_at || 0);
        if (sortBy === 'Oldest')
          return +new Date(a.created_at || 0) - +new Date(b.created_at || 0);
        return 0;
      });

      if (__DEV__) {
        console.debug(
          `[DateFeed] fetched=${base.length} afterFilters=${sorted.length} viewer=${
            viewer ? JSON.stringify(viewer) : 'none'
          }`
        );
      }
      // **De-dupe by id right here (page boundary safety)**
      return { rows: uniqueById(sorted), pageUsed: pageArg };
    },
    [
      canQuery,
      userId,
      profile,
      radius,
      filterText,
      sortBy,
      dateStateFilter,
      selectedTypes,
      hiddenIds,
      locationName,
      hydrateLatLng,
      overrideCoords,
    ]
  );

  const refreshList = useCallback(
    async (_coordsOverride?: { lat: number; lng: number }) => {
      if (!canQuery) return;
      try {
        onEndReachedOkRef.current = false;
        setRefreshing(true);
        setRpcError(null);
        const { rows } = await fetchPage(1, _coordsOverride);
        setDates(uniqueById(rows)); // ✅ de-dupe on refresh
        setPage(2);
        setHasMore(rows.length === PAGE_SIZE);
        setFirstLoadDone(true);
      } catch (e: any) {
        console.error('[DateFeed] refresh error', e?.message || e);
        setRpcError(
          'We had trouble loading dates. Pull to refresh to try again.'
        );
      } finally {
        setLoadingInitial(false);
        setRefreshing(false);
        setFetchingMore(false);
      }
    },
    [canQuery, fetchPage]
  );
  useEffect(() => {
    refreshListRef.current = refreshList;
  }, [refreshList]);

  const loadMore = useCallback(async () => {
    if (!canQuery || fetchingMore || !hasMore) return;
    try {
      setFetchingMore(true);
      const { rows } = await fetchPage(
        page,
        lastCoordsRef.current || undefined
      );
      setDates((prev) => uniqueById([...prev, ...rows])); // ✅ safe append
      if (rows.length === PAGE_SIZE) setPage((prev) => prev + 1);
      else setHasMore(false);
    } catch (e) {
      console.error('[DateFeed] loadMore error]', e);
    } finally {
      setFetchingMore(false);
    }
  }, [canQuery, fetchPage, page, hasMore, fetchingMore]);

  // Initial load
  useEffect(() => {
    if (filtersLoaded && userId && profile) {
      setHasMore(true);
      setPage(1);
      refreshList();
    }
  }, [filtersLoaded, userId, profile, refreshList]);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      if (userId && profile) {
        setHasMore(true);
        setPage(1);
        refreshList();
      }
    }, [userId, profile, refreshList])
  );

  // Not Interested
  const onNotInterested = useCallback(
    async (dateId: string) => {
      if (!userId) return;
      setPinned((p) => (p?.id && String(p.id) === String(dateId) ? null : p));
      setDates((prev) => uniqueById(prev.filter((d) => String(d.id) !== String(dateId))));
      const next = new Set(hiddenIds);
      next.add(String(dateId));
      setHiddenIds(next);
      saveHidden(userId, next);
      try {
        const { error } = await supabase
          .from('user_hidden_dates')
          .upsert({ user_id: userId, date_id: dateId }, { onConflict: 'user_id,date_id' });
        if (error) console.warn('[NotInterested] upsert warning:', error);
      } catch (err) {
        console.warn('[NotInterested] upsert failed:', err);
      }
    },
    [userId, hiddenIds, saveHidden]
  );

  // Invite PIN & SCROLL
  const handledInviteRef = useRef(false);
  const ensurePinnedVisible = useCallback(
    async (dateId: string) => {
      let row =
        dates.find((d) => String(d.id) === String(dateId)) || null;
      if (!row) row = await fetchSingleDateRow(String(dateId));
      if (!row) return;

      setPinned(row);
      setDates((prev) => uniqueById([row!, ...prev.filter((d) => String(d.id) !== String(row!.id))]));

      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: 0, animated: true });
        } catch {
          // ignore
        }
      }, 120);
    },
    [dates, fetchSingleDateRow]
  );

  useEffect(() => {
    if (!userId || !profile || handledInviteRef.current) return;
    handledInviteRef.current = true;
    (async () => {
      try {
        const res = await consumePendingInviteAfterLogin();
        const dateId =
          (res as any)?.date_id ||
          (res as any)?.dateId ||
          (res as any)?.date?.id;
        if (dateId) await ensurePinnedVisible(String(dateId));
      } catch {
        // ignore
      }
    })();
  }, [userId, profile, ensurePinnedVisible]);

  // ===== Places autocomplete (robust chain) =====
  const debouncedQueryStr =
    typeof debouncedQuery === 'string' ? debouncedQuery : '';
  useEffect(() => {
    const q = debouncedQueryStr.trim();
    if (!hasPlaces) {
      setSuggestions([]);
      setOpenDropdown(false);
      return;
    }
    if (!q || q.length < 3) {
      setSuggestions([]);
      setOpenDropdown(false);
      return;
    }
    let cancelled = false;

    const run = async () => {
      try {
        setLoadingSuggest(true);

        const components =
          PLACES_COUNTRIES.length > 0
            ? `&components=${PLACES_COUNTRIES.map((c) => `country:${c}`).join('|')}`
            : '';
        const base = `input=${encodeURIComponent(
          q
        )}&language=en&key=${GOOGLE_KEY}&sessiontoken=${sessionToken}&locationbias=ipbias${components}`;

        // A) Cities only
        let url = `${AUTOCOMPLETE_ENDPOINT}?${base}&types=(cities)`;
        let res = await fetch(url);
        let json = await res.json();
        if (
          !cancelled &&
          json?.status === 'OK' &&
          Array.isArray(json?.predictions) &&
          json.predictions.length
        ) {
          const items: Suggestion[] = json.predictions.map((p: any) => ({
            description: p.description,
            place_id: p.place_id,
          }));
          setSuggestions(items);
          setOpenDropdown(true);
          return;
        }

        // A2) Regions
        url = `${AUTOCOMPLETE_ENDPOINT}?${base}&types=(regions)`;
        res = await fetch(url);
        json = await res.json();
        if (
          !cancelled &&
          json?.status === 'OK' &&
          Array.isArray(json?.predictions) &&
          json.predictions.length
        ) {
          const filtered = json.predictions.filter(isCityPrediction);
          const items: Suggestion[] = filtered.map((p: any) => ({
            description: p.description,
            place_id: p.place_id,
          }));
          if (items.length) {
            setSuggestions(items);
            setOpenDropdown(true);
            return;
          }
        }

        // B) General autocomplete, filter to cities
        url = `${AUTOCOMPLETE_ENDPOINT}?${base}`;
        res = await fetch(url);
        json = await res.json();
        if (
          !cancelled &&
          json?.status === 'OK' &&
          Array.isArray(json?.predictions) &&
          json.predictions.length
        ) {
          const filtered = json.predictions.filter(isCityPrediction);
          const items: Suggestion[] = filtered.map((p: any) => ({
            description: p.description,
            place_id: p.place_id,
          }));
          if (items.length) {
            setSuggestions(items);
            setOpenDropdown(true);
            return;
          }
        }

        // C) Find Place
        url = `${FINDPLACE_ENDPOINT}?input=${encodeURIComponent(
          q
        )}&inputtype=textquery&fields=place_id,formatted_address,name,geometry&key=${GOOGLE_KEY}&sessiontoken=${sessionToken}`;
        res = await fetch(url);
        json = await res.json();
        if (
          !cancelled &&
          json?.status === 'OK' &&
          Array.isArray(json?.candidates) &&
          json.candidates.length
        ) {
          const items: Suggestion[] = json.candidates.map((c: any) => ({
            description: c.formatted_address || c.name,
            place_id: c.place_id,
          }));
          setSuggestions(items);
          setOpenDropdown(true);
          return;
        }

        // D) Geocode → pseudo suggestion
        url = `${GEOCODE_ENDPOINT}?address=${encodeURIComponent(
          q
        )}&key=${GOOGLE_KEY}`;
        res = await fetch(url);
        json = await res.json();
        if (
          !cancelled &&
          json?.status === 'OK' &&
          Array.isArray(json?.results) &&
          json.results.length
        ) {
          const r = json.results[0];
          const label = r ? r.formatted_address || r.name : undefined;
          const loc = r?.geometry?.location;
          if (label && loc?.lat != null && loc?.lng != null) {
            setSuggestions([
              { description: label, place_id: `geo:${loc.lat},${loc.lng}` },
            ]);
            setOpenDropdown(true);
            return;
          }
        }

        if (!cancelled) {
          setSuggestions([]);
          setOpenDropdown(false);
        }
      } catch (e) {
        if (__DEV__) console.warn('[Places ERROR]', e);
        if (!cancelled) {
          setSuggestions([]);
          setOpenDropdown(false);
        }
      } finally {
        if (!cancelled) setLoadingSuggest(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [debouncedQueryStr, sessionToken, hasPlaces]);

  const resolvePlaceDetails = useCallback(
    async (place_id: string, label: string) => {
      if (!hasPlaces) return;

      if (place_id.startsWith('geo:')) {
        try {
          const [latS, lngS] = place_id.slice(4).split(',');
          const lat = parseFloat(latS),
            lng = parseFloat(lngS);
          if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
            const coords = { lat, lng };
            setOverrideCoords(coords);
            setLocationName(label);
            setFilterText(label);
            await AsyncStorage.multiSet([
              ['locationName', label],
              ['filterText', label],
            ]);
            await persistFilters();
            if (userId && profile) refreshListRef.current?.(coords);
          }
        } catch {
          // ignore
        }
        return;
      }

      try {
        const url = `${DETAILS_ENDPOINT}?place_id=${encodeURIComponent(
          place_id
        )}&fields=geometry,name&key=${GOOGLE_KEY}&sessiontoken=${sessionToken}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json?.status === 'OK' && json?.result?.geometry?.location) {
          const { lat, lng } = json.result.geometry.location;
          const coords = { lat, lng };
          setOverrideCoords(coords);
          setLocationName(label);
          setFilterText(label);
          await AsyncStorage.multiSet([
            ['locationName', label],
            ['filterText', label],
          ]);
          await persistFilters();
          if (userId && profile) refreshListRef.current?.(coords);
        }
      } catch (e) {
        if (__DEV__) console.warn('[Places Details ERROR]', e);
      }
    },
    [persistFilters, profile, sessionToken, hasPlaces, userId]
  );

  // ===== Robust navigation helper for the New Date footer tab =====
  const goToCreateDateTab = useCallback(() => {
    const looksLikeCreateTab = (name: string) => {
      const n = name.toLowerCase().replace(/[\s_-]/g, '');
      return [
        'newdate',
        'createdate',
        'new',
        'create',
        'createdatetab',
        'newdatetab',
      ].includes(n);
    };
    let nav: any = navigation;
    for (let i = 0; i < 5 && nav; i++) {
      const state = nav?.getState?.();
      const routeNames: string[] = Array.isArray(state?.routeNames)
        ? state.routeNames
        : [];
      const match = routeNames.find(looksLikeCreateTab);
      if (match) {
        try {
          nav.navigate(match as never);
          return;
        } catch {}
        try {
          nav.navigate(
            match as never,
            { screen: 'CreateDateScreen' } as never
          );
          return;
        } catch {}
      }
      nav = nav?.getParent?.();
    }
    const FALLBACKS = [
      { name: 'New Date' },
      { name: 'NewDate' },
      { name: 'CreateDate' },
      { name: 'Create Date' },
      { name: 'NewDateTab' },
      { name: 'CreateDateTab' },
      { name: 'CreateDateScreen' },
    ];
    for (const f of FALLBACKS) {
      try {
        navigation.dispatch(CommonActions.navigate({ name: f.name as any }));
        return;
      } catch {}
      try {
        navigation.navigate(f.name as never);
        return;
      } catch {}
    }
  }, [navigation]);

  // ===== Header Filters =====
  const FiltersPanel = (
    <View style={[styles.filterPanelOuter, { paddingTop: insets.top + 6 }]}>
      <TouchableOpacity
        onPress={() => {
          Keyboard.dismiss();
          setShowFilters((s) => !s);
        }}
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
          <TouchableOpacity
            style={styles.currentLocBtn}
            onPress={getCurrentLocation}
            activeOpacity={0.9}
          >
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
                setFilterText(t); // keep in sync
                if (t.trim().length >= 3) setOpenDropdown(true);
                if (t.trim().length === 0) {
                  setSuggestions([]);
                  setOpenDropdown(false);
                  setOverrideCoords(null);
                }
              }}
              placeholderTextColor="#8A94A6"
              onFocus={() => {
                if (suggestions.length > 0) setOpenDropdown(true);
              }}
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
                    <Text style={{ marginLeft: 8, color: '#6b7280' }}>
                      Searching cities…
                    </Text>
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
                          setOpenDropdown(false);
                          setSuggestions([]);
                          resolvePlaceDetails(
                            item.place_id,
                            item.description
                          );
                        }}
                      >
                        <Text style={{ color: '#111827' }}>
                          {item.description}
                        </Text>
                      </TouchableOpacity>
                    )}
                    ItemSeparatorComponent={() => (
                      <View style={styles.separator} />
                    )}
                  />
                )}
              </View>
            )}
          </View>

          {/* Distance */}
          <Text style={[styles.label, { marginTop: 12 }]}>📏 Distance</Text>
          <View style={styles.chipRowWrap}>
            {['10', '25', '50', '100', '150', '250', 'Nationwide', 'All'].map(
              (item) => {
                const active = radius === item;
                return (
                  <TouchableOpacity
                    key={item}
                    onPress={async () => {
                      setRadius(item);
                      await persistFilters();
                      refreshList();
                    }}
                    style={[styles.chip, active && styles.chipActive]}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={active ? styles.chipTextActive : styles.chipText}
                    >
                      {item}
                      {/^\d+$/.test(item) ? ' mi' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              }
            )}
          </View>

          {/* Status */}
          <Text style={[styles.label, { marginTop: 12 }]}>Status</Text>
          <View style={styles.chipRowWrap}>
            {stateOptions.map((opt) => {
              const active = dateStateFilter === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={async () => {
                    setDateStateFilter(opt);
                    await persistFilters();
                    refreshList();
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={active ? styles.chipTextActive : styles.chipText}
                  >
                    {opt}
                  </Text>
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
                    const next = active
                      ? selectedTypes.filter((t) => t !== opt)
                      : [...selectedTypes, opt];
                    setSelectedTypes(next);
                    await persistFilters();
                    refreshList();
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={active ? styles.chipTextActive : styles.chipText}
                  >
                    {opt}
                  </Text>
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
                  onPress={async () => {
                    setSortBy(opt);
                    await persistFilters();
                    refreshList();
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={active ? styles.chipTextActive : styles.chipText}
                  >
                    {opt}
                  </Text>
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
      return (
        <View style={{ paddingVertical: 12 }}>
          <ActivityIndicator />
        </View>
      );
    }
    if (!hasMore && dates.length > 0) {
      return (
        <View>
          <Text style={{ textAlign: 'center', padding: 12, color: 'gray' }}>
            No more results
          </Text>
        </View>
      );
    }
    return null;
  }, [fetchingMore, hasMore, dates.length]);

  // ===== Deep-link scroll (param or prop) =====
  const lastHandledIdRef = useRef<string | undefined>(undefined);
  const tryScrollToId = useCallback(
    (id?: string) => {
      if (!id) return;
      const full = pinned
        ? [pinned, ...dates.filter((d) => d.id !== pinned.id)]
        : dates;
      if (!full.length) return;
      if (lastHandledIdRef.current === id) return;
      const index = full.findIndex((d) => String(d.id) === String(id));
      if (index !== -1) {
        flatListRef.current?.scrollToIndex({ index, animated: true });
        lastHandledIdRef.current = id;
        // clear wrapper param so it doesn't re-trigger
        try {
          navigation.setParams({ scrollToDateId: undefined } as any);
        } catch {
          // ignore
        }
      }
    },
    [dates, pinned, navigation]
  );

  useFocusEffect(
    useCallback(() => {
      const idFromProp = scrollToDateId ?? (route.params as any)?.scrollToDateId;
      if (!loadingInitial && !refreshing) tryScrollToId(idFromProp);
    }, [scrollToDateId, route.params, loadingInitial, refreshing, tryScrollToId])
  );

  // --- Render data (prepend pinned if present) ---
  const listData = useMemo(
    () =>
      pinned ? [pinned, ...dates.filter((d) => d.id !== pinned.id)] : dates,
    [pinned, dates]
  );

  // **Final last-mile de-dupe for render safety**
  const safeData = useMemo(() => uniqueById(listData), [listData]);

  // DEV-only: log if duplicates slipped through
  if (__DEV__) {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const it of safeData) {
      const k = String(it.id);
      if (seen.has(k)) dups.push(k);
      seen.add(k);
    }
    if (dups.length) {
      // eslint-disable-next-line no-console
      console.warn('[DateFeed] duplicate ids after safeData de-dupe', dups);
    }
  }

  // --- UI ---
  return (
    <AnimatedScreenWrapper
      showLogo={false}
      {...({ style: { backgroundColor: '#FFFFFF' } } as any)}
    >
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        {FiltersPanel}

        <FlatList
          ref={flatListRef}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 8 }}
          data={safeData}                         // ✅ de-duped data
          keyExtractor={(item) => String(item.id)}// ✅ stable & unique now
          renderItem={({ item }) => (
            <DateCard
              date={item}
              userId={userId ?? ''}
              isCreator={item.creator_id === userId}
              isAccepted={false}
              disabled={false}
              onPressProfile={(pid) =>
                navigation.navigate('PublicProfile' as any, {
                  userId: pid,
                  origin: 'DateFeed',
                } as any)
              }
              onPressCard={() => {
                /* hook for details */
              }}
              onNotInterested={() => onNotInterested(String(item.id))}
            />
          )}
          removeClippedSubviews={false}
          windowSize={10}
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={60}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => refreshList()}
            />
          }
          onEndReached={() => {
            if (!onEndReachedOkRef.current) return;
            if (!loadingInitial && !refreshing && hasMore && !fetchingMore)
              loadMore();
          }}
          onEndReachedThreshold={0.4}
          onMomentumScrollBegin={() => {
            onEndReachedOkRef.current = true;
          }}
          onScrollToIndexFailed={(info) => {
            setTimeout(
              () =>
                flatListRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                }),
              250
            );
          }}
          ListFooterComponent={ListFooter}
          ListEmptyComponent={
            firstLoadDone && !loadingInitial && !refreshing ? (
              <View
                style={{ width: '100%', alignItems: 'center', padding: 24 }}
              >
                {!userId ? (
                  <>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '500',
                        marginBottom: 10,
                        textAlign: 'center',
                      }}
                    >
                      You’re signed out. Log in to see dates.
                    </Text>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('Login' as any)}
                      style={styles.primaryBtn}
                    >
                      <Text style={styles.primaryBtnText}>Log In</Text>
                    </TouchableOpacity>
                  </>
                ) : rpcError ? (
                  <>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '500',
                        marginBottom: 10,
                        textAlign: 'center',
                      }}
                    >
                      {rpcError}
                    </Text>
                    <TouchableOpacity
                      onPress={() => refreshList()}
                      style={styles.primaryBtn}
                    >
                      <Text style={styles.primaryBtnText}>Retry</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '500',
                        marginBottom: 10,
                        textAlign: 'center',
                      }}
                    >
                      There are no dates nearby — yet. Be a pioneer and create
                      one!
                      {'\n'}
                      From one‑on‑one dinners to poker nights, concerts, or a
                      classy yacht party — your invite could spark the next
                      great connection.
                    </Text>
                    <TouchableOpacity
                      onPress={goToCreateDateTab}
                      style={styles.primaryBtn}
                    >
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
};

export default memo(DateFeedScreen);

// ===== Styles =====
const styles = StyleSheet.create({
  // Filter panel
  filterPanelOuter: { backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  filterToggle: { paddingVertical: 8, alignItems: 'flex-start' },
  toggle: { fontSize: 14, fontWeight: '600', color: DRYNKS_RED },
  filterPanel: {
    backgroundColor: DRYNKS_GRAY,
    padding: 12,
    borderRadius: 12,
    marginTop: 10,
  },
  label: { fontSize: 12, fontWeight: '600', marginTop: 4, color: DRYNKS_BLUE },

  currentLocBtn: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#DADFE6',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  currentLocText: { color: DRYNKS_BLUE, fontWeight: '700' },

  // Places dropdown
  input: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginTop: 8,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1F2A33',
  },
  dropdown: {
    position: 'absolute',
    top: 58,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    zIndex: 1000,
    maxHeight: 240,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
  },
  separator: { height: 1, backgroundColor: '#F3F4F6' },

  // Chips
  chipRowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  chip: {
    backgroundColor: '#ddd',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { backgroundColor: DRYNKS_BLUE },
  chipText: { fontSize: 12, color: '#333' },
  chipTextActive: { fontSize: 12, color: '#fff', fontWeight: '600' },

  // Buttons
  primaryBtn: {
    backgroundColor: DRYNKS_RED,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  primaryBtnText: { color: 'white', fontWeight: '700' },
});
