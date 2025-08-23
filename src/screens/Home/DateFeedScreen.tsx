// src/screens/Home/DateFeedScreen.tsx
// Production ready (stable pagination + pull-to-refresh + focus refresh + FaceID first-arrival prompt + per-user "Not Interested")
// - Hides "Not Interested" cards permanently for the signed-in user (AsyncStorage + optional server persist)
// - No jumping/jitter (separate flags + momentum gate)
// - Uses your filters/header/footer as-is
// - Passes openProfile/openDateDetails + onNotInterested to DateCard

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@config/supabase';
import CustomLocationInput from '@components/CustomLocationInput';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import DateCard from '@components/cards/DateCard';
import { tryPromptIfArmed } from '@services/QuickUnlockService';

const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F5F5F5';
const DRYNKS_RED = '#E34E5C';

const sortOptions = ['Upcoming', 'Distance', 'Newest', 'Oldest'] as const;
const stateOptions = ['Available Dates', 'Filled Dates', 'Passed Dates', 'All'] as const;
const typeOptions = ['group', 'one-on-one'] as const;

type UUID = string;

type Profile = {
  id: UUID;
  gender: string | null;
  orientation: string;
  latitude: number | null;
  longitude: number | null;
  location?: string | null;
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
  creator_profile: any | null;
  accepted_profiles: any[] | null;
  created_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location?: string | null;
  spots?: number | null;
  preferred_gender_counts?: Record<string, number> | null;
  remaining_gender_counts?: Record<string, number> | null;
};

const PAGE_SIZE = 10;

// WKT/hex-ish guard that sometimes sneaks into location columns
const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const hiddenKeyFor = (uid: string) => `hidden_dates_v1:${uid}`;

export default function DateFeedScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute() as any;
  const flatListRef = useRef<FlatList<DateRow>>(null);

  // --- auth/profile ---
  const [userId, setUserId] = useState<UUID | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // --- data ---
  const [dates, setDates] = useState<DateRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // --- flags (separate to avoid jitter) ---
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const onEndReachedOkRef = useRef(false); // momentum gate

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

  // --- per-user hidden IDs ---
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // --- helpers ---
  const isPast = (d: DateRow) => {
    if (!d?.event_date) return false;
    const dt = new Date(d.event_date);
    return !Number.isNaN(+dt) && dt < new Date();
  };
  const isFull = (d: DateRow) => {
    const rgc = d.remaining_gender_counts;
    if (!rgc || typeof rgc !== 'object') return false;
    return Object.values(rgc).every(v => typeof v === 'number' && v === 0);
  };

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
    if (map.locationName) setLocationName(map.locationName);
    setFiltersLoaded(true);
  }, []);

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

  // ----- geocode -----
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

  const getCurrentLocation = async () => {
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
      if (userId && profile) refreshList({ lat: coords.latitude, lng: coords.longitude });
    } catch {
      Alert.alert('Location Error', 'Could not fetch your location.');
    }
  };

  // ----- bootstrap filters + session -----
  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  const hydrateSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      setUserId(null);
      setProfile(null);
      setDates([]);
      setHiddenIds(new Set());
      setLoadingInitial(false);
      setRefreshing(false);
      setFetchingMore(false);
      setFirstLoadDone(true);
      return;
    }

    const uid = session.user.id as UUID;
    setUserId(uid);

    // load hidden for this user
    loadHidden(uid);

    const { data: prof } = await supabase
      .from('profiles')
      .select('id, gender, orientation, latitude, longitude, location')
      .eq('id', uid)
      .single();

    if (prof) {
      setProfile(prof as Profile);
      if (!locationName && prof.location) setLocationName(prof.location);
      if (!locationName && prof.latitude != null && prof.longitude != null) {
        reverseGeocodeToCity(prof.latitude, prof.longitude);
      }
    }
  }, [locationName, reverseGeocodeToCity, loadHidden]);

  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  // Re-hydrate on auth state changes
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, _s) => {
      hydrateSession();
    });
    return () => sub.subscription?.unsubscribe();
  }, [hydrateSession]);

  // ======= FaceID / TouchID first-arrival prompt =======
  useEffect(() => {
    (async () => {
      const didPrompt = await tryPromptIfArmed(async (refresh_token) => {
        await supabase.auth.refreshSession({ refresh_token });
      });
      if (didPrompt) {
        await hydrateSession();
        await refreshList();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ======= FETCHING (stable flags) =======
  const canQuery = useMemo(() => !!userId && !!profile, [userId, profile]);

  const fetchPage = useCallback(
    async (pageArg: number, coords?: { lat: number; lng: number }) => {
      if (!canQuery) return { rows: [] as DateRow[], pageUsed: pageArg };

      const coordsToUse = coords ?? overrideCoords ?? {
        lat: profile!.latitude ?? 0,
        lng: profile!.longitude ?? 0,
      };

      const { data, error } = await supabase.rpc('get_date_cards_for_user_paginated', {
        viewer_id: userId,
        viewer_gender: profile!.gender,
        viewer_orientation: profile!.orientation,
        viewer_lat: coordsToUse.lat,
        viewer_lng: coordsToUse.lng,
        page: pageArg,
        page_size: PAGE_SIZE,
      });

      if (error) throw error;

      const baseRows = (data ?? []) as DateRow[];

      // sanitize locations (show city name, not WKT/hex), then filter/sort
      const rows = baseRows.map((d) => {
        const cleanLoc = !looksLikeWKTOrHex(d.location)
          ? d.location
          : (d?.creator_profile?.location ?? '');
        return { ...d, location: cleanLoc };
      });

      const filtered = rows.filter((d) => {
        // hide if user marked Not Interested
        if (hiddenIds.has(String(d.id))) return false;

        const past = isPast(d);
        const full = isFull(d);

        const orientationMatch = Array.isArray(d.orientation_preference)
          ? d.orientation_preference.includes(profile!.orientation) ||
            d.orientation_preference.includes('Everyone')
          : true;

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

        if (!orientationMatch || !typeMatch || !withinRadius || !locationMatch) return false;

        if (dateStateFilter === 'Available Dates' && full) return false;
        if (dateStateFilter === 'Filled Dates' && !full) return false;
        if (dateStateFilter === 'Passed Dates' && !past) return false;

        return true;
      });

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

      return { rows: sorted, pageUsed: pageArg };
    },
    [canQuery, userId, profile, overrideCoords, radius, filterText, sortBy, dateStateFilter, selectedTypes, hiddenIds]
  );

  const refreshList = useCallback(
    async (coordsOverride?: { lat: number; lng: number }) => {
      if (!canQuery) return;
      try {
        setRefreshing(true);
        setRpcError(null);
        const { rows } = await fetchPage(1, coordsOverride);
        setDates(rows);
        setPage(2);
        setHasMore(rows.length === PAGE_SIZE);
        setFirstLoadDone(true);
      } catch (e) {
        console.error('[DateFeed] refresh error', e);
        setRpcError('We had trouble loading dates. Please pull to refresh again.');
      } finally {
        setLoadingInitial(false);
        setRefreshing(false);
        setFetchingMore(false);
      }
    },
    [canQuery, fetchPage]
  );

  const loadMore = useCallback(async () => {
    if (!canQuery || fetchingMore || !hasMore) return;
    try {
      setFetchingMore(true);
      const { rows } = await fetchPage(page);
      setDates(prev => [...prev, ...rows]);
      if (rows.length === PAGE_SIZE) {
        setPage(prev => prev + 1);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error('[DateFeed] loadMore error', e);
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

  // optional scroll-to-card
  useEffect(() => {
    if (route.params?.scrollToDateId && dates.length > 0 && flatListRef.current) {
      const index = dates.findIndex((d) => d.id === route.params.scrollToDateId);
      if (index !== -1) flatListRef.current.scrollToIndex({ index, animated: true });
    }
  }, [route.params?.scrollToDateId, dates]);

  // ======= Not Interested handler (per-user hide) =======
  const onNotInterested = useCallback(async (dateId: string) => {
    if (!userId) return;

    // Optimistic local hide
    setDates(prev => prev.filter(d => String(d.id) !== String(dateId)));
    const next = new Set(hiddenIds);
    next.add(String(dateId));
    setHiddenIds(next);
    saveHidden(userId, next);

    // Optional: server persistence (ignore error if table doesn't exist)
    // Expecting a table like: user_hidden_dates(user_id uuid, date_id uuid, primary key (user_id, date_id))
    try {
      await supabase.from('user_hidden_dates').upsert(
        { user_id: userId, date_id: dateId },
        { onConflict: 'user_id,date_id' }
      );
    } catch {
      // ignore – local persistence is enough
    }
  }, [userId, hiddenIds, saveHidden]);

  // --------- Header (filters) ---------
  const ListHeader = useMemo(() => (
    <View>
      <TouchableOpacity onPress={() => setShowFilters((s) => !s)}>
        <Text style={styles.toggle}>{showFilters ? 'Hide Filters ▲' : 'Show Filters ▼'}</Text>
      </TouchableOpacity>

      {showFilters && (
        <View style={styles.filterPanel}>
          {/* Location row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.label}>📍 Location</Text>
            <TouchableOpacity onPress={getCurrentLocation}>
              <Text style={{ fontSize: 20 }}>📍</Text>
            </TouchableOpacity>
          </View>

          {/* City input */}
          <View style={{ zIndex: 1000, marginBottom: 12 }}>
            <CustomLocationInput
              value={locationName}
              onLocationSelect={async ({ name, latitude, longitude }) => {
                setFilterText(name || '');
                setLocationName(name || '');
                setOverrideCoords({ lat: latitude, lng: longitude });
                await persistFilters();
                if (userId && profile) refreshList({ lat: latitude, lng: longitude });
              }}
            />
          </View>

          {/* Distance */}
          <Text style={styles.label}>📏 Distance (miles)</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={['10', '25', '50', '100', '150', '250', 'Nationwide', 'All']}
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={async () => {
                  setRadius(item);
                  await persistFilters();
                  refreshList();
                }}
                style={[styles.chip, radius === item && styles.chipActive]}
              >
                <Text style={radius === item ? styles.chipTextActive : styles.chipText}>
                  {item}{item.match(/^\d+$/) ? ' mi' : ''}
                </Text>
              </TouchableOpacity>
            )}
          />

          {/* Status */}
          <Text style={[styles.label, { marginTop: 12 }]}>Date Status</Text>
          <View style={styles.chipRow}>
            {stateOptions.map((opt) => (
              <TouchableOpacity
                key={opt}
                onPress={async () => {
                  setDateStateFilter(opt);
                  await persistFilters();
                  refreshList();
                }}
                style={[styles.chip, dateStateFilter === opt && styles.chipActive]}
              >
                <Text style={dateStateFilter === opt ? styles.chipTextActive : styles.chipText}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Type */}
          <Text style={[styles.label, { marginTop: 12 }]}>Date Type</Text>
          <View style={styles.chipRow}>
            {typeOptions.map((opt) => {
              const active = selectedTypes.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={async () => {
                    const next = active ? selectedTypes.filter(t => t !== opt) : [...selectedTypes, opt];
                    setSelectedTypes(next);
                    await persistFilters();
                    refreshList();
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
          <View style={styles.chipRow}>
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
                  <Text style={active ? styles.chipTextActive : styles.chipText}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [showFilters, locationName, radius, dateStateFilter, selectedTypes, sortBy, userId, profile]);

  // --------- Footer ---------
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
          <Text style={{ textAlign: 'center', padding: 12, color: 'gray' }}>No more results</Text>
        </View>
      );
    }
    return null;
  }, [fetchingMore, hasMore, dates.length]);

  // ===== Navigation helpers (used by DateCard) =====
  const openProfile = (creatorId: string) => {
    navigation.navigate('PublicProfile' as never, { userId: creatorId, origin: 'DateFeed' } as never);
  };
  const openDateDetails = (dateId: string) => {
    navigation.navigate('DateDetails' as never, { dateId } as never);
  };

  // --- UI ---
  return (
    <AnimatedScreenWrapper showLogo={false} {...({ style: { backgroundColor: '#FFFFFF' } } as any)}>
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={{ flex: 1, paddingHorizontal: 12, backgroundColor: '#FFFFFF' }}>
              <FlatList
                ref={flatListRef}
                ListHeaderComponent={ListHeader}
                ListFooterComponent={ListFooter}
                contentContainerStyle={{ paddingBottom: 24 }}
                data={dates}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <DateCard
                    date={item}
                    userId={userId!}
                    isCreator={item.creator_id === userId}
                    isAccepted={false}
                    disabled={false}
                    onPressProfile={(pid) => openProfile(pid)}
                    onPressCard={() => openDateDetails(item.id)}
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
                onMomentumScrollBegin={() => {
                  onEndReachedOkRef.current = true;
                }}
                ListEmptyComponent={
                  firstLoadDone && !loadingInitial && !refreshing
                    ? (
                        <View style={{ width: '100%', alignItems: 'center', padding: 24 }}>
                          {!userId ? (
                            <>
                              <Text style={{ fontSize: 16, fontWeight: '500', marginBottom: 10, textAlign: 'center' }}>
                                You’re signed out. Log in to see dates.
                              </Text>
                              <TouchableOpacity
                                onPress={() => navigation.navigate('Auth' as never)}
                                style={{
                                  backgroundColor: DRYNKS_RED,
                                  paddingHorizontal: 16,
                                  paddingVertical: 12,
                                  borderRadius: 10,
                                  marginTop: 8,
                                }}
                              >
                                <Text style={{ color: 'white', fontWeight: '600' }}>Log In</Text>
                              </TouchableOpacity>
                            </>
                          ) : rpcError ? (
                            <>
                              <Text style={{ fontSize: 16, fontWeight: '500', marginBottom: 10, textAlign: 'center' }}>
                                {rpcError}
                              </Text>
                              <TouchableOpacity
                                onPress={() => refreshList()}
                                style={{
                                  backgroundColor: DRYNKS_RED,
                                  paddingHorizontal: 16,
                                  paddingVertical: 12,
                                  borderRadius: 10,
                                  marginTop: 8,
                                }}
                              >
                                <Text style={{ color: 'white', fontWeight: '600' }}>Retry</Text>
                              </TouchableOpacity>
                            </>
                          ) : (
                            <>
                              <Text style={{ fontSize: 16, fontWeight: '500', marginBottom: 10, textAlign: 'center' }}>
                                There are no dates nearby — yet. Be a pioneer and create one!
                                {'\n'}We count on our amazing users to host fun, spontaneous, and meaningful events.
                                {'\n'}From romantic one-on-one dates, to poker nights with friends, concert adventures, or even a classy yacht party — your invite could spark the next great connection.
                                {'\n'}Throw a charity gala and need a plus-one? Someone out there is looking to join you.
                                {'\n'}Be the first. Create your next date.
                              </Text>
                              <TouchableOpacity
                                onPress={() => navigation.navigate('New Date' as never)}
                                style={{
                                  backgroundColor: DRYNKS_RED,
                                  paddingHorizontal: 16,
                                  paddingVertical: 12,
                                  borderRadius: 10,
                                  marginTop: 8,
                                }}
                              >
                                <Text style={{ color: 'white', fontWeight: '600' }}>+ Create Date</Text>
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      )
                    : null
                }
              />
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </View>
    </AnimatedScreenWrapper>
  );
}

const styles = StyleSheet.create({
  toggle: { fontSize: 14, fontWeight: '600', color: DRYNKS_RED, marginVertical: 10 },
  filterPanel: { backgroundColor: DRYNKS_GRAY, padding: 12, borderRadius: 12, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6, color: DRYNKS_BLUE },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
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
});
