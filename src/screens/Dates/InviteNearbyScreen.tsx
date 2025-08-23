// Invite Nearby with:
// - grid/list toggle
// - distance chips
// - origin-aware profile nav
// - pagination + skeletons
// - "invited" state that disables the ProfileCard's Invite button
// - DONE -> navigate to My Dates tab (with header/footer)
// - Robust notifications insert (falls back if `type` column doesn't exist)

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
} from 'react-native';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
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

type NearbyParams = {
  eventLocation: { latitude: number; longitude: number };
  genderPrefs: Record<string, string | number>;
  orientationPref: string[];
  dateId?: string;
};

const milesToKm = (mi: number) => mi * 1.60934;

const InviteNearbyScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute() as any;

  const { eventLocation, genderPrefs, orientationPref, dateId }: NearbyParams = route.params || {};

  const [loggedInUser, setLoggedInUser] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // default ~250 mi in km (historical 402.336)
  const [radiusKm, setRadiusKm] = useState<number>(402.336);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // invited per date (persist locally so we don't re-invite)
  const invitedKey = useMemo(() => `invited_${dateId || 'no_date'}`, [dateId]);
  const [invitedUserIds, setInvitedUserIds] = useState<Set<string>>(new Set());

  // ---------- bootstrap ----------
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setLoggedInUser(data?.user ?? null);
    })();
  }, []);

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
    } catch { /* ignore */ }
  }, [invitedKey]);

  useEffect(() => {
    if (!loggedInUser || !eventLocation) return;
    // reset + fetch when radius changes or after we have session
    setUsers([]);
    setHasMore(true);
    setPage(0);
    fetchUsersNearby(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedInUser, radiusKm]);

  const selectedGenders = Object.keys(genderPrefs || {}).filter(
    (k) => Number(genderPrefs[k] ?? 0) > 0
  );

  const fetchUsersNearby = useCallback(
    async (pageNumber: number, replace = false) => {
      if (!loggedInUser || !eventLocation) return;
      try {
        setLoading(true);
        const { data, error } = await supabase.rpc('get_users_nearby_event', {
          lat: eventLocation.latitude,
          lng: eventLocation.longitude,
          radius_km: radiusKm,
          user_id: loggedInUser.id,
          date_id: dateId || '00000000-0000-0000-0000-000000000000',
          range_start: pageNumber * PAGE_SIZE,
          range_end: (pageNumber + 1) * PAGE_SIZE - 1,
          orientation_prefs: orientationPref || [],
          gender_prefs: selectedGenders,
        });

        if (error) throw error;

        const rows = Array.isArray(data) ? data : [];
        if (rows.length < PAGE_SIZE) setHasMore(false);

        setUsers((prev) => (replace ? rows : [...prev, ...rows]));
        setPage(pageNumber);
      } catch (err) {
        console.error('❌ get_users_nearby_event error:', err);
        Alert.alert('Error', 'Could not load nearby users right now.');
      } finally {
        setLoading(false);
      }
    },
    [loggedInUser, eventLocation, radiusKm, dateId, orientationPref, selectedGenders]
  );

  const handleLoadMore = () => {
    if (!loading && hasMore) fetchUsersNearby(page + 1);
  };

  const handleShareInvite = async () => {
    try {
      await Clipboard.setStringAsync('https://drnksapp.com/invite');
      await Linking.openURL('sms:&body=Join me on DrYnks: https://drnksapp.com/invite');
      Alert.alert('Invite Copied', 'You can paste it anywhere or send directly via text.');
    } catch {
      Alert.alert('Invite', 'Could not open Messages. The invite link is copied.');
    }
  };

  // ---- Navigate to My Dates (keep it simple first, then fallbacks) ----
  const goToMyDatesTab = useCallback(() => {
    // Primary: switch RootStack ("App") → Tab "My DrYnks"
    try { navigation.navigate('App', { screen: 'My DrYnks' }); return; } catch {}
    // If already inside the tab navigator, switch tabs directly
    const parent = navigation.getParent?.();
    if (parent) {
      try { parent.navigate('My DrYnks'); return; } catch {}
      try { parent.navigate('MyDates'); return; } catch {}
      try { parent.navigate('Dates'); return; } catch {}
    }
    // Hard reset as last resort (ensure header/footer via tabs)
    navigation.reset({ index: 0, routes: [{ name: 'App', params: { screen: 'My DrYnks' } } as any] });
  }, [navigation]);

  const isSelectedMiles = (mi: number) => {
    // 10000 = Nationwide sentinel; treat as 10000 km selected only when radiusKm equals ~10000
    if (mi === 10000) return radiusKm >= 9999;
    return Math.abs(radiusKm - milesToKm(mi)) < 0.5;
  };

  // single source of truth to open a profile with origin awareness
  const openProfileFromInvite = (userId: string) => {
    navigation.navigate('PublicProfile', { userId, origin: 'InviteNearby' });
  };

  // ---- Robust notifications insert (handles absence of `type` column) ----
  const insertNotification = useCallback(
    async (base: {
      user_id: string;
      type: string;            // preferred if column exists
      title: string;
      body?: string | null;
      data?: Record<string, any> | null;
    }) => {
      // 1) Try with `type`
      const { error: e1 } = await supabase.from('notifications').insert([base]);
      if (!e1) return true;

      const msg = String(e1?.message || '').toLowerCase();
      // If error isn't about "type", bubble up
      if (!msg.includes(`'type'`) && !msg.includes('type') && !msg.includes('schema cache')) {
        throw e1;
      }

      // 2) Try with `event_type`
      const { error: e2 } = await supabase.from('notifications').insert([{
        user_id: base.user_id,
        event_type: base.type,
        title: base.title,
        body: base.body ?? null,
        data: base.data ?? null,
      }]);
      if (!e2) return true;

      // 3) Try without any type column (put it inside data)
      const { error: e3 } = await supabase.from('notifications').insert([{
        user_id: base.user_id,
        title: base.title,
        body: base.body ?? null,
        data: { ...(base.data || {}), kind: base.type },
      }]);
      if (!e3) return true;

      // Still failing → throw the last error
      throw e3;
    },
    []
  );

  // --- Invite logic: write a notification row, then mark locally as invited ---
  const inviteUser = useCallback(
    async (recipientId: string, recipientScreenname?: string) => {
      if (!loggedInUser) return;
      if (invitedUserIds.has(recipientId)) return;

      try {
        await insertNotification({
          user_id: recipientId,
          type: 'invite', // preferred
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

  const renderItem = ({ item }: { item: any }) => {
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: DRYNKS_WHITE }]}>
        <Image source={require('../../../assets/images/DrYnks_Y_logo.png')} style={styles.logo} />
        <TouchableOpacity onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}>
          <Text style={styles.toggle}>{viewMode === 'list' ? 'Grid View' : 'Full View'}</Text>
        </TouchableOpacity>
      </View>

      {/* Distance chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.radiusBar} contentContainerStyle={{ paddingRight: 8 }}>
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
          {[...Array(3)].map((_, i) => <ProfileCardSkeleton key={i} />)}
        </View>
      ) : users.length === 0 ? (
        <View style={{ padding: 24, marginTop: 12, backgroundColor: '#fefefe', borderRadius: 12, marginHorizontal: 16 }}>
          <Text style={{ textAlign: 'center', fontSize: 16, fontWeight: '600', color: DRYNKS_BLUE, marginBottom: 10 }}>
            You’re a DrYnks Pioneer 🚀
          </Text>
          <Text style={{ textAlign: 'center', fontSize: 14, color: '#444' }}>
            Share your date with friends — it’s all better with good company. 🍸
          </Text>
        </View>
      ) : (
        <FlatList
          data={users}
          key={viewMode} // relayout on mode switch
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          numColumns={viewMode === 'grid' ? 2 : 1}
          columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140, paddingTop: 8 }}
          ListFooterComponent={
            loading && users.length > 0 ? (
              <View style={{ paddingVertical: 12 }}>
                <ActivityIndicator />
              </View>
            ) : null
          }
        />
      )}

      {/* Bottom actions */}
      <TouchableOpacity style={styles.inviteButton} onPress={handleShareInvite}>
        <Text style={styles.buttonText}>Invite via Text</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.doneButton} onPress={goToMyDatesTab}>
        <Text style={styles.buttonText}>Done</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const CHIP_HEIGHT = 44;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DRYNKS_WHITE },

  header: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    flexDirection: 'row',
  },
  logo: { width: 48, height: 48, resizeMode: 'contain' },
  toggle: { fontSize: 14, color: DRYNKS_RED, fontWeight: '600' },

  radiusBar: { paddingVertical: 12, paddingLeft: 16 },
  radiusChip: {
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: 18,
    borderRadius: CHIP_HEIGHT / 2,
    borderColor: DRYNKS_BLUE,
    borderWidth: 1,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusChipSelected: { backgroundColor: DRYNKS_BLUE },
  radiusChipText: { fontSize: 15, color: DRYNKS_BLUE },
  radiusChipTextSelected: { color: DRYNKS_WHITE, fontWeight: '700' },

  card: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    backgroundColor: '#fff',
    paddingBottom: 12,
  },
  gridCard: {
    width: (width - 48) / 2,
    marginBottom: 16,
  },

  inviteButton: {
    position: 'absolute',
    bottom: 70,
    left: 20,
    right: 20,
    backgroundColor: DRYNKS_BLUE,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: DRYNKS_RED,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: DRYNKS_WHITE, fontWeight: '600', fontSize: 16 },
});

export default InviteNearbyScreen;
