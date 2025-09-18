// src/screens/Dates/MyDatesScreen.tsx
// MyDatesScreen — Production Ready (compact header, avatar opens ProfileMenu; chips never overlap header)
// Bell button robustly opens a Notifications screen if it exists; otherwise shows an in‑screen fallback sheet.

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Image,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import DateCard from '@components/cards/DateCard';
import Chip from '@components/ui/Chip';
import { Ionicons } from '@expo/vector-icons';
import ProfileMenu from '@components/common/ProfileMenu';

type UUID = string;

type ProfileLite = {
  id: UUID;
  screenname: string | null;
  profile_photo: string | null;
  birthdate?: string | null;
  gender?: string | null;
  location?: string | null;
  preferences?: string[] | null;
};

type DateRow = {
  id: UUID;
  title: string | null;
  location: string | null;
  event_date: string | null;
  event_type: string | null;
  who_pays: string | null;
  orientation_preference: string[] | null;
  profile_photo: string | null;
  photo_urls: string[] | null;
  creator: UUID;
  accepted_users: UUID[] | null;
  spots: number | null;
  preferred_gender_counts: Record<string, number> | null;
  remaining_gender_counts: Record<string, number> | null;
};

const PAGE_SIZE = 20;
const DRYNKS_BLUE = '#232F39';
const DRYNKS_RED = '#E34E5C';
const DRYNKS_WHITE = '#FFFFFF';

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(s || ''));

const MyDatesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<UUID | null>(null);

  const [tab, setTab] = useState<'created' | 'accepted'>('created');

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [created, setCreated] = useState<any[]>([]);
  const [accepted, setAccepted] = useState<any[]>([]);
  const [createdPage, setCreatedPage] = useState(1);
  const [acceptedPage, setAcceptedPage] = useState(1);
  const [createdHasMore, setCreatedHasMore] = useState(true);
  const [acceptedHasMore, setAcceptedHasMore] = useState(true);

  // Fallback notifications sheet (opens if no Notifications route exists)
  const [notifSheetVisible, setNotifSheetVisible] = useState(false);

  // Hide the native header; we render our own compact header
  useLayoutEffect(() => {
    navigation.setOptions?.({ headerShown: false });
  }, [navigation]);

  // Bootstrap session (we only need userId here)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id as UUID | undefined;
      if (uid) setUserId(uid);
    })();
  }, []);

  // Helper: fetch profiles for creator/accepted users
  const fetchProfiles = useCallback(async (ids: UUID[]): Promise<Record<string, ProfileLite>> => {
    if (!ids.length) return {};
    const { data, error } = await supabase
      .from('profiles')
      .select('id, screenname, profile_photo, birthdate, gender, location, preferences')
      .in('id', ids);
    if (error || !data) return {};
    return data.reduce((acc: Record<string, ProfileLite>, p: any) => {
      acc[p.id] = p;
      return acc;
    }, {});
  }, []);

  // Shape rows for DateCard
  const hydrate = useCallback(
    async (rows: DateRow[], viewer: UUID) => {
      const creatorIds = Array.from(new Set(rows.map(r => r.creator)));
      const acceptedIds = Array.from(
        new Set(rows.flatMap(r => (Array.isArray(r.accepted_users) ? r.accepted_users : [])))
      );
      const map = await fetchProfiles(Array.from(new Set([...creatorIds, ...acceptedIds])));

      return rows.map((r) => {
        const creator_profile = map[r.creator] || null;
        const accepted_profiles = (r.accepted_users || [])
          .map((id) => map[id])
          .filter(Boolean);

        const cleanedLocation = looksLikeWKTOrHex(r.location)
          ? (creator_profile?.location ?? null)
          : r.location;

        return {
          id: r.id,
          title: r.title,
          event_date: r.event_date,
          who_pays: r.who_pays,
          event_type: r.event_type,
          orientation_preference: r.orientation_preference || [],
          distance_miles: null,
          profile_photo: r.profile_photo,
          photo_urls: r.photo_urls || [],
          creator_id: r.creator,
          creator_profile,
          accepted_profiles,
          spots: r.spots,
          preferred_gender_counts: r.preferred_gender_counts || {},
          remaining_gender_counts: r.remaining_gender_counts || {},
          location: cleanedLocation,
        };
      });
    },
    [fetchProfiles]
  );

  const loadCreated = useCallback(
    async (page = 1, append = false) => {
      if (!userId) return;
      if (!append) setLoading(true);
      try {
        const { data, error } = await supabase
          .from('date_requests')
          .select(
            'id, title, location, event_date, event_type, who_pays, orientation_preference, profile_photo, photo_urls, creator, accepted_users, spots, preferred_gender_counts, remaining_gender_counts'
          )
          .eq('creator', userId)
          .order('event_date', { ascending: false })
          .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

        if (error) return;
        const hydrated = await hydrate((data || []) as DateRow[], userId);
        setCreated(prev => (append ? [...prev, ...hydrated] : hydrated));
        setCreatedHasMore((data || []).length === PAGE_SIZE);
        setCreatedPage(page);
      } finally {
        if (!append) setLoading(false);
      }
    },
    [userId, hydrate]
  );

  const loadAccepted = useCallback(
    async (page = 1, append = false) => {
      if (!userId) return;
      if (!append) setLoading(true);
      try {
        const { data, error } = await supabase
          .from('date_requests')
          .select(
            'id, title, location, event_date, event_type, who_pays, orientation_preference, profile_photo, photo_urls, creator, accepted_users, spots, preferred_gender_counts, remaining_gender_counts'
          )
          .contains('accepted_users', [userId])
          .order('event_date', { ascending: false })
          .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

        if (error) return;
        const hydrated = await hydrate((data || []) as DateRow[], userId);
        setAccepted(prev => (append ? [...prev, ...hydrated] : hydrated));
        setAcceptedHasMore((data || []).length === PAGE_SIZE);
        setAcceptedPage(page);
      } finally {
        if (!append) setLoading(false);
      }
    },
    [userId, hydrate]
  );

  // Initial load per tab
  useEffect(() => {
    if (!userId) return;
    if (tab === 'created') loadCreated(1, false);
    else loadAccepted(1, false);
  }, [userId, tab, loadCreated, loadAccepted]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    (tab === 'created' ? loadCreated(1, false) : loadAccepted(1, false)).finally(() =>
      setRefreshing(false)
    );
  }, [tab, loadCreated, loadAccepted]);

  const data = tab === 'created' ? created : accepted;

  // ---------- Header sizes ----------
  const HEADER_BAR_HEIGHT = 48; // touch-friendly
  const HEADER_H = insets.top + HEADER_BAR_HEIGHT;

  // ---------- Navigation helpers ----------
  const smartNavigate = useCallback(
    (names: string[], params?: any) => {
      let nav: any = navigation;
      for (let level = 0; level < 5 && nav; level++) {
        const state = nav?.getState?.();
        const routeNames: string[] = Array.isArray(state?.routeNames) ? state.routeNames : [];
        const name = names.find(n => routeNames.includes(n));
        if (name) {
          try { nav.navigate(name as never, params as never); return true; } catch {}
        }
        nav = nav?.getParent?.();
      }
      try {
        navigation.dispatch(
          CommonActions.navigate({ name: 'App' as never, params: { screen: names[0], params } as never })
        );
        return true;
      } catch {}
      return false;
    },
    [navigation]
  );

  const openNotifications = useCallback(() => {
    const ok = smartNavigate(
      ['Notifications', 'NotificationsScreen', 'NotificationCenter', 'Alerts', 'Activity', 'Inbox']
    );
    if (!ok) setNotifSheetVisible(true);
  }, [smartNavigate]);

  const goToReceivedInvites = useCallback(() => {
    const ok = smartNavigate(['MyInvites', 'ReceivedInvites', 'InvitesInbox']);
    if (!ok) smartNavigate(['Dates', 'MyInvites' as any]);
    setNotifSheetVisible(false);
  }, [smartNavigate]);

  const goToJoinRequests = useCallback(() => {
    const ok = smartNavigate(['JoinRequests', 'Requests', 'Applicants']);
    if (!ok) smartNavigate(['Dates', 'JoinRequests' as any]);
    setNotifSheetVisible(false);
  }, [smartNavigate]);

  const goToSentInvites = useCallback(() => {
    const ok = smartNavigate(['MySentInvites', 'SentInvites']);
    if (!ok) smartNavigate(['Dates', 'MySentInvites' as any]);
    setNotifSheetVisible(false);
  }, [smartNavigate]);

  // ---------- UI ----------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DRYNKS_WHITE }}>
      <StatusBar barStyle="dark-content" />

      {/* Fixed, tappable header (on top of everything) */}
      <View style={[styles.headerWrap, { paddingTop: insets.top }]}>
        <View style={[styles.headerBar, { height: HEADER_BAR_HEIGHT }]}>
          <ProfileMenu />

          <Image
            source={require('@assets/images/DrYnks_Y_logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />

          <TouchableOpacity
            onPress={openNotifications}
            accessibilityLabel="Open Notifications"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="notifications-outline" size={22} color={DRYNKS_BLUE} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content is offset below the fixed header so chips never overlap it */}
      <View style={{ flex: 1, paddingTop: HEADER_H }}>
        {/* Tabs */}
        <View style={styles.tabsRow}>
          <Chip label="Created" active={tab === 'created'} onPress={() => setTab('created')} />
          <Chip label="Accepted" active={tab === 'accepted'} onPress={() => setTab('accepted')} />
        </View>

        {/* List */}
        {loading && data.length === 0 ? (
          <View style={{ padding: 24 }}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={data}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <DateCard
                date={item}
                userId={userId!}
                context={tab === 'created' ? 'MY_CREATED' : 'MY_ACCEPTED'}
                isAccepted={tab === 'accepted'}
                onChat={() => {
                  try { navigation.navigate('GroupChat', { dateId: item.id }); } catch {}
                }}
                onChanged={(ev) => {
                  if (ev === 'removed') {
                    if (tab === 'created') setCreated(prev => prev.filter((d: any) => d.id !== item.id));
                    else setAccepted(prev => prev.filter((d: any) => d.id !== item.id));
                  }
                }}
              />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            onEndReached={() => {
              if (tab === 'created' && createdHasMore) loadCreated(createdPage + 1, true);
              if (tab === 'accepted' && acceptedHasMore) loadAccepted(acceptedPage + 1, true);
            }}
            onEndReachedThreshold={0.5}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {tab === 'created'
                  ? "You haven't created any dates yet."
                  : "You haven't accepted any dates yet."}
              </Text>
            }
            contentContainerStyle={{ paddingBottom: 24 }}
          />
        )}
      </View>

      {/* ---------- Fallback Notifications Sheet ---------- */}
      <Modal
        visible={notifSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNotifSheetVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setNotifSheetVisible(false)}
          style={styles.sheetOverlay}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Notifications</Text>

            <TouchableOpacity style={styles.sheetRow} onPress={goToReceivedInvites}>
              <Ionicons name="mail-unread-outline" color={DRYNKS_BLUE} size={18} />
              <Text style={styles.sheetText}>Received Invites</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetRow} onPress={goToJoinRequests}>
              <Ionicons name="people-outline" color={DRYNKS_BLUE} size={18} />
              <Text style={styles.sheetText}>Join Requests</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetRow} onPress={goToSentInvites}>
              <Ionicons name="paper-plane-outline" color={DRYNKS_BLUE} size={18} />
              <Text style={styles.sheetText}>Sent Invites</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetRow, { justifyContent: 'center', marginTop: 8 }]}
              onPress={() => setNotifSheetVisible(false)}
            >
              <Text style={[styles.sheetText, { color: DRYNKS_RED, fontWeight: '700' }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // Fixed header (above everything, blocks touches behind it)
  headerWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 200,
    backgroundColor: DRYNKS_WHITE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    ...Platform.select({ android: { elevation: 8 } as any }),
  },
  headerBar: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLogo: { width: 24, height: 24, tintColor: DRYNKS_RED },

  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: DRYNKS_WHITE,
  },

  empty: {
    textAlign: 'center',
    color: '#8C97A4',
    padding: 24,
  },

  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  sheet: {
    margin: 16,
    backgroundColor: DRYNKS_WHITE,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  sheetTitle: {
    fontWeight: '800',
    color: DRYNKS_BLUE,
    fontSize: 16,
    marginBottom: 10,
    textAlign: 'center',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  sheetText: { color: DRYNKS_BLUE, fontSize: 15, flexShrink: 1 },
});

export default MyDatesScreen;
