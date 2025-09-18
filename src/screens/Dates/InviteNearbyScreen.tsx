// Invite Nearby — production ready (DrYnks)
// - Uses date_requests (not dates) to resolve event coords + filters
// - Handles orientation as string OR string[] in fallback
// - Grid/list toggle
// - Distance chips under header
// - Empty state never hidden behind bottom buttons
// - Robust notifications insert
// - Page-0 RPC -> fallback
// - Normalize rows exactly once before setState (no double mapping)

import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
// in miles; last entry acts as "Nationwide"
const DISTANCE_OPTIONS_MI = [25, 50, 100, 150, 200, 250, 450, 10000];

// Flip to force local fallback during debugging
const USE_RPC = true;
// Source-of-truth tables
const DATE_TABLE = 'date_requests';
const PROFILE_TABLE = 'profiles';

type NearbyParams = {
  eventLocation?: { latitude?: number; longitude?: number } | null;
  latitude?: number | null;
  longitude?: number | null;
  genderPrefs?: Record<string, string | number> | null;
  orientationPref?: string[] | null;
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
  orientation?: string | null;   // collapsed for display
  about?: string | null;
  gallery_photos?: string[];
  distance_km?: number;          // may come from RPC
};

const milesToKm = (mi: number) => mi * 1.60934;

// Local Haversine (km) for fallback filtering
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

const CHIP_HEIGHT = 40;

// ---------- tiny utils ----------
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

// Shape normalizer for ProfileCard safety
const mapToProfileCardUser = (row: any): CardUser => ({
  id: String(row.id),
  screenname: row.screenname ?? row.username ?? 'Guest',
  profile_photo: row.profile_photo ?? row.primary_photo ?? null,
  location: row.location ?? '',
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  gender: row.gender ?? null,
  // collapse array orientation to one display label; keep string as-is
  orientation: Array.isArray(row.orientation) ? (row.orientation[0] ?? null) : (row.orientation ?? null),
  about: row.about ?? row.bio ?? '',
  // ensure array (text[] | jsonb[] -> plain array)
  gallery_photos: Array.isArray(row.gallery_photos) ? row.gallery_photos : (row.gallery_photos ?? []),
  distance_km: typeof row.distance_km === 'number' ? row.distance_km : undefined,
});

const InviteNearbyScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute() as any;

  // raw params from navigator
  const {
    eventLocation: paramLoc,
    latitude: latParam,
    longitude: lngParam,
    genderPrefs: paramGenderPrefs,
    orientationPref: paramOrientation,
    dateId: dateIdParam,
  }: NearbyParams = route.params || {};

  const [dateId, setDateId] = useState<string | null>(dateIdParam ?? null);

  // Resolved event coordinates for this screen (always required to fetch)
  const [eventLat, setEventLat] = useState<number | null>(
    asNumber(paramLoc?.latitude) ?? asNumber(latParam)
  );
  const [eventLng, setEventLng] = useState<number | null>(
    asNumber(paramLoc?.longitude) ?? asNumber(lngParam)
  );

  // If no gender/orientation came through the route, we’ll fill them from the date row.
  const [genderPrefs, setGenderPrefs] = useState<Record<string, number>>(
    normalizeGenderKeys(paramGenderPrefs as any)
  );
  const [orientationPref, setOrientationPref] = useState<string[] | null>(
    Array.isArray(paramOrientation) ? paramOrientation : null
  );

  // Fetch the date ONLY if we’re missing lat/lng or filters
  useEffect(() => {
    (async () => {
      if (eventLat != null && eventLng != null && orientationPref && Object.keys(genderPrefs).length) {
        return; // nothing to do
      }
      const idToFetch = dateId ?? dateIdParam ?? null;
      if (!idToFetch) return;

      const { data, error } = await supabase
        .from(DATE_TABLE) // date_requests
        .select('id, latitude, longitude, preferred_gender_counts, orientation_preference')
        .eq('id', idToFetch)
        .single();

      if (error) {
        if (__DEV__) console.warn('[InviteNearby] could not fetch date row:', error.message);
        return;
      }
      setDateId(data?.id ?? idToFetch);

      if (eventLat == null && asNumber(data?.latitude) != null) {
        setEventLat(asNumber(data?.latitude));
      }
      if (eventLng == null && asNumber(data?.longitude) != null) {
        setEventLng(asNumber(data?.longitude));
      }

      try {
        // preferred_gender_counts might be JSON text or object
        const rawPGC =
          typeof data?.preferred_gender_counts === 'string'
            ? JSON.parse(data?.preferred_gender_counts)
            : data?.preferred_gender_counts;
        const normalized = normalizeGenderKeys(rawPGC);
        if (!Object.keys(genderPrefs).length && Object.keys(normalized).length) {
          setGenderPrefs(normalized);
        }
      } catch {
        /* ignore bad JSON */
      }

      if (!orientationPref) {
        const arr = Array.isArray(data?.orientation_preference) && data?.orientation_preference.length
          ? data?.orientation_preference
          : ['Everyone'];
        setOrientationPref(arr);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateId, dateIdParam, eventLat, eventLng]);

  const [loggedInUser, setLoggedInUser] = useState<any>(null);
  const [users, setUsers] = useState<CardUser[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // default ~250 mi in km (402.336)
  const [radiusKm, setRadiusKm] = useState<number>(402.336);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // invited per date (persist locally so we don't re-invite)
  const invitedKey = useMemo(() => `invited_${(dateId ?? 'no_date')}`, [dateId]);
  const [invitedUserIds, setInvitedUserIds] = useState<Set<string>>(new Set());

  // ---------- bootstrap ----------
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error && __DEV__) console.warn('[InviteNearby] auth.getUser error:', error.message);
      setLoggedInUser(data?.user ?? null);
    })();
  }, []);

  // Safe defaults: if no orientation is provided, treat as "Everyone"
  const normOrientation = useMemo<string[]>(
    () =>
      Array.isArray(orientationPref) && orientationPref.length > 0
        ? orientationPref
        : ['Everyone'],
    [orientationPref]
  );

  // Build selected genders from counts object (keys with > 0)
  const selectedGenders = useMemo(
    () => Object.keys(genderPrefs || {}).filter((k) => Number((genderPrefs as any)[k] ?? 0) > 0),
    [genderPrefs]
  );

  // load invited set from storage whenever dateId changes
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(invitedKey);
        if (raw) {
          const arr = JSON.parse(raw) as string[];
          setInvitedUserIds(new Set(arr));
        } else {
          setInvitedUserIds(new Set());
        }
      } catch {
        setInvitedUserIds(new Set());
      }
    })();
  }, [invitedKey]);

  // save invited set whenever it changes
  const persistInvited = useCallback(async (next: Set<string>) => {
    try {
      await AsyncStorage.setItem(invitedKey, JSON.stringify(Array.from(next)));
    } catch {
      // ignore
    }
  }, [invitedKey]);

  // Reset & fetch when all prerequisites are present
  useEffect(() => {
    if (!loggedInUser) return;
    if (eventLat == null || eventLng == null) return; // wait until we have coordinates
    setUsers([]);
    setHasMore(true);
    setPage(0);
    fetchUsersNearby(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedInUser, radiusKm, eventLat, eventLng, normOrientation.join('|'), selectedGenders.join('|')]);

  // ---- Fallback query (shared)
  const runFallbackQuery = useCallback(
    async (pageNumber: number, replace = false) => {
      if (eventLat == null || eventLng == null) return;
      const { data: all, error: qErr } = await supabase
        .from(PROFILE_TABLE)
        .select(
          'id, screenname, profile_photo, location, latitude, longitude, gender, orientation, about, gallery_photos'
        )
        .neq('id', loggedInUser.id)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(600);
      if (qErr) throw qErr;

      const filtered = (all || []).filter((p: any) => {
        // gender
        if (selectedGenders.length && (!p.gender || !selectedGenders.includes(p.gender))) {
          return false;
        }

        // orientation (support string OR string[]; treat 'Everyone' as open)
        {
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
            // if profile orientation is null/empty -> allow
          }
        }

        const d = haversineKm(eventLat, eventLng, p.latitude, p.longitude);
        return d <= radiusKm;
      });

      // sort by distance asc
      filtered.sort((a: any, b: any) => {
        const da = haversineKm(eventLat, eventLng, a.latitude, a.longitude);
        const db = haversineKm(eventLat, eventLng, b.latitude, b.longitude);
        return da - db;
      });

      // paginate
      const start = pageNumber * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const slice = filtered.slice(start, end);

      // normalize once here
      const normalizedSlice: CardUser[] = slice.map(mapToProfileCardUser);

      if (normalizedSlice.length < PAGE_SIZE || end >= filtered.length) setHasMore(false);
      setUsers((prev) => (replace ? normalizedSlice : [...prev, ...normalizedSlice]));
      setPage(pageNumber);
    },
    [eventLat, eventLng, loggedInUser?.id, normOrientation, radiusKm, selectedGenders]
  );

  // ---- RPC + Fallback (with empty‑result fallback on page 0)
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
              date_id: dateId || '00000000-0000-0000-0000-000000000000',
              range_start: pageNumber * PAGE_SIZE,
              range_end: (pageNumber + 1) * PAGE_SIZE - 1,
              orientation_prefs: normOrientation,
              gender_prefs: selectedGenders,
            };

            const { data, error } = await supabase.rpc('get_users_nearby_event', params);
            if (__DEV__) {
              console.log('[InviteNearby] RPC', {
                page: pageNumber,
                lat: eventLat,
                lng: eventLng,
                radiusKm,
                genders: selectedGenders,
                orient: normOrientation,
                len: Array.isArray(data) ? data.length : 0,
                err: error?.message,
              });
            }
            if (error) throw error;

            const rows = Array.isArray(data) ? data : [];

            // If first page comes back empty, immediately try the local fallback.
            if (rows.length === 0 && pageNumber === 0) {
              if (__DEV__) console.warn('[InviteNearby] RPC returned 0 on page 0 — falling back locally');
              await runFallbackQuery(pageNumber, replace);
              setLoading(false);
              return;
            }

            // normalize once here
            const normalized: CardUser[] = rows.map(mapToProfileCardUser);

            if (normalized.length < PAGE_SIZE) setHasMore(false);
            setUsers((prev) => (replace ? normalized : [...prev, ...normalized]));
            setPage(pageNumber);
            setLoading(false);
            return;
          } catch (rpcErr) {
            if (__DEV__) console.warn('[InviteNearby] RPC failed, using fallback:', rpcErr);
          }
        }

        // Fallback path
        await runFallbackQuery(pageNumber, replace);
      } catch (err) {
        console.error('[InviteNearby] fetch error:', err);
        Alert.alert('Error', 'Could not load nearby users right now.');
      } finally {
        setLoading(false);
      }
    },
    [
      loggedInUser,
      eventLat,
      eventLng,
      radiusKm,
      dateId,
      normOrientation,
      selectedGenders,
      runFallbackQuery,
    ]
  );

  const handleLoadMore = () => {
    if (!loading && hasMore) fetchUsersNearby(page + 1);
  };

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

  // ---- Navigate to My Dates tab
  const goToMyDatesTab = useCallback(() => {
    try {
      navigation.navigate('App', { screen: 'My DrYnks' });
      return;
    } catch {}
    const parent = navigation.getParent?.();
    if (parent) {
      try { parent.navigate('My DrYnks'); return; } catch {}
      try { parent.navigate('MyDates');  return; } catch {}
      try { parent.navigate('Dates');    return; } catch {}
    }
    navigation.reset({ index: 0, routes: [{ name: 'App', params: { screen: 'My DrYnks' } } as any] });
  }, [navigation]);

  const isSelectedMiles = (mi: number) => {
    if (mi === 10000) return radiusKm >= 9999;
    return Math.abs(radiusKm - milesToKm(mi)) < 0.5;
  };

  // origin-aware profile open
  const openProfileFromInvite = (userId: string) => {
    navigation.navigate('PublicProfile', { userId, origin: 'InviteNearby' });
  };

  // ---- Robust notifications insert (handles absence of `type` column)
  const insertNotification = useCallback(
    async (base: {
      user_id: string;
      type: string; // preferred if column exists
      title: string;
      body?: string | null;
      data?: Record<string, any> | null;
    }) => {
      const { error: e1 } = await supabase.from('notifications').insert([base]);
      if (!e1) return true;

      const msg = String(e1?.message || '').toLowerCase();
      if (!msg.includes(`'type'`) && !msg.includes('type') && !msg.includes('schema cache')) {
        throw e1;
      }

      const { error: e2 } = await supabase.from('notifications').insert([
        {
          user_id: base.user_id,
          event_type: base.type,
          title: base.title,
          body: base.body ?? null,
          data: base.data ?? null,
        },
      ]);
      if (!e2) return true;

      const { error: e3 } = await supabase.from('notifications').insert([
        {
          user_id: base.user_id,
          title: base.title,
          body: base.body ?? null,
          data: { ...(base.data || {}), kind: base.type },
        },
      ]);
      if (!e3) return true;

      throw e3;
    },
    []
  );

  const inviteUser = useCallback(
    async (recipientId: string, recipientScreenname?: string) => {
      if (!loggedInUser) return;
      if (invitedUserIds.has(recipientId)) return;

      try {
        await insertNotification({
          user_id: recipientId,
          type: 'invite',
          title: 'You have a DrYnks invite 🍸',
          body: 'Open the app to view and respond.',
          data: {
            action: 'invite_inapp',
            date_id: dateId || null,
            inviter_id: loggedInUser.id,
          },
        });

        const next = new Set(invitedUserIds);
        next.add(recipientId);
        setInvitedUserIds(next);
        persistInvited(next);

        Alert.alert('Invite sent', recipientScreenname || 'Guest');
      } catch (err: any) {
        console.error('inviteUser error:', err);
        Alert.alert('Invite failed', err?.message || 'Please try again.');
      }
    },
    [loggedInUser, invitedUserIds, persistInvited, dateId, insertNotification]
  );

  // ---> NO mapping here. Items are already normalized.
  const renderItem = ({ item }: { item: CardUser }) => {
    const uid = String(item.id);
    const alreadyInvited = invitedUserIds.has(uid);

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

  // ---- layout pieces ----
  const headerPaddingTop = Math.max(insets.top, 8);
  const bottomStackPadding = 52 /*Done*/ + 12 + 52 /*Invite*/ + 16 + insets.bottom;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
        <Image source={require('../../../assets/images/DrYnks_Y_logo.png')} style={styles.logo} />
        <TouchableOpacity onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}>
          <Text style={styles.toggle}>{viewMode === 'list' ? 'Grid View' : 'Full View'}</Text>
        </TouchableOpacity>
      </View>

      {/* Distance chips (fixed sizing, right under header) */}
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
          {[...Array(3)].map((_, i) => (
            <ProfileCardSkeleton key={i} />
          ))}
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
          key={viewMode} // relayout on mode switch
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          numColumns={viewMode === 'grid' ? 2 : 1}
          columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: bottomStackPadding, // ensures cards are never hidden
          }}
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
      <TouchableOpacity
        style={[styles.inviteButton, { bottom: 20 + insets.bottom + 52 + 12 }]}
        onPress={handleShareInvite}
      >
        <Text style={styles.buttonText}>Invite via Text</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.doneButton, { bottom: 20 + insets.bottom }]}
        onPress={goToMyDatesTab}
      >
        <Text style={styles.buttonText}>Done</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

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
    height: CHIP_HEIGHT, // fixed height to avoid stretching
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
  gridCard: {
    width: (width - 48) / 2,
    marginBottom: 16,
  },

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
