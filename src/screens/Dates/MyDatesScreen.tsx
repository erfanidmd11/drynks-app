// src/screens/Dates/MyDatesScreen.tsx
// MyDatesScreen — Production Ready (Created & Accepted tabs)
// - Accepted tab is driven by public.date_requests (status='accepted') joined to dates
// - Shows Chat / Invite Friends / Cancel
// - Forces the viewer's mini profile to be the 3rd avatar on the card's attendees strip order
// - Uses realtime on public.date_requests to keep Accepted fresh
// - Safe fallbacks if some relationships aren't declared (no hard crashes)

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '@config/supabase';
import DateCard from '@components/cards/DateCard';
import Chip from '@components/ui/Chip';
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
  accepted_users: UUID[] | null; // recipient_ids that are accepted for this date
  spots: number | null;
  preferred_gender_counts: Record<string, number> | null;
  remaining_gender_counts: Record<string, number> | null;
};

type AcceptedItem = DateRow & { req_id: UUID }; // include the recipient's accepted DR id for Cancel

const PAGE_SIZE = 20;
const DRYNKS_BLUE = '#232F39';
const DRYNKS_RED = '#E34E5C';
const DRYNKS_WHITE = '#FFFFFF';

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(s || ''));

// Force viewer to be 3rd avatar (index 2) if present
function orderAttendeesForViewer<T extends { id?: string; user_id?: string }>(
  attendees: T[],
  viewerId?: string | null
) {
  if (!viewerId) return attendees;
  const idOf = (a: T) => (a.user_id ?? a.id ?? '').toString();
  const meIdx = attendees.findIndex(a => idOf(a) === viewerId);
  if (meIdx < 0) return attendees;
  const me = attendees[meIdx];
  const others = attendees.filter((_, i) => i !== meIdx);
  const out: T[] = [];

  // Build list up to 6 items, placing the viewer at index 2
  const max = Math.min(6, others.length + 1);
  for (let i = 0, j = 0; i < max; i++) {
    if (i === 2) out.push(me);
    else if (others[j]) { out.push(others[j]); j++; }
  }
  // If fewer than 3 total, still ensure me is present
  if (!out.some(a => idOf(a) === viewerId)) out.splice(Math.min(2, out.length), 0, me);
  return out.slice(0, 6);
}

const MyDatesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<UUID | null>(null);

  const [tab, setTab] = useState<'created' | 'accepted'>('created');

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [created, setCreated] = useState<DateRow[]>([]);
  const [accepted, setAccepted] = useState<AcceptedItem[]>([]);
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

  // ---------- Helpers ----------

  // Fetch a bunch of profiles by id
  const fetchProfiles = useCallback(async (ids: UUID[]): Promise<Record<string, ProfileLite>> => {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length) return {};
    const { data, error } = await supabase
      .from('profiles')
      .select('id, screenname, profile_photo, birthdate, gender, location, preferences')
      .in('id', uniq);
    if (error || !data) return {};
    return data.reduce((acc: Record<string, ProfileLite>, p: any) => {
      acc[p.id] = p;
      return acc;
    }, {});
  }, []);

  // Convert raw dates into card‑ready rows (inject profiles + attendees order)
  const hydrate = useCallback(
    async <T extends DateRow | AcceptedItem>(rows: T[], viewer: UUID): Promise<T[]> => {
      const creatorIds = rows.map(r => r.creator).filter(Boolean) as UUID[];
      const acceptedIds = rows.flatMap(r => (Array.isArray(r.accepted_users) ? r.accepted_users! : []));
      const map = await fetchProfiles(Array.from(new Set([...creatorIds, ...acceptedIds])));

      return rows.map((r) => {
        const creator_profile = map[r.creator] || null;
        let accepted_profiles = (r.accepted_users || [])
          .map((id) => map[id])
          .filter(Boolean);

        // enforce "viewer is 3rd avatar"
        accepted_profiles = orderAttendeesForViewer(
          accepted_profiles.map(p => ({ ...p, id: p.id })), // shallow copy to keep stable
          viewer
        ) as any;

        const cleanedLocation = looksLikeWKTOrHex(r.location)
          ? (creator_profile?.location ?? null)
          : r.location;

        return {
          ...r,
          creator_profile,
          accepted_profiles,
          location: cleanedLocation,
        };
      });
    },
    [fetchProfiles]
  );

  // ---------- Loaders ----------

  // CREATOR tab: dates the viewer created (source of truth: public.dates)
  const loadCreated = useCallback(
    async (page = 1, append = false) => {
      if (!userId) return;
      if (!append) setLoading(true);
      try {
        // 1) Pull dates created by me
        const { data: dts, error } = await supabase
          .from('dates')
          .select(
            'id, title, location, event_date, event_type, who_pays, orientation_preference, profile_photo, photo_urls, creator, spots, preferred_gender_counts, remaining_gender_counts'
          )
          .eq('creator', userId)
          .order('event_date', { ascending: false })
          .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

        if (error) {
          console.error('[MyDatesScreen] loadCreated:', error.message);
          return;
        }

        const rows = (dts || []) as DateRow[];

        // 2) For these dates, gather all accepted recipient_ids for attendee strip
        const dateIds = rows.map(r => r.id);
        let accMap = new Map<string, UUID[]>();
        if (dateIds.length) {
          const { data: accRows, error: accErr } = await supabase
            .from('date_requests')
            .select('date_id, recipient_id')
            .in('date_id', dateIds)
            .eq('status', 'accepted');
          if (!accErr && accRows) {
            for (const r of accRows) {
              const list = accMap.get(r.date_id) || [];
              if (!list.includes(r.recipient_id)) list.push(r.recipient_id);
              accMap.set(r.date_id, list);
            }
          }
        }

        // 3) Attach accepted_users and hydrate with profiles
        const withAccepted = rows.map(r => ({ ...r, accepted_users: accMap.get(r.id) ?? [] }));
        const hydrated = await hydrate(withAccepted, userId);

        setCreated(prev => (append ? [...prev, ...(hydrated as DateRow[])] : (hydrated as DateRow[])));
        setCreatedHasMore((rows || []).length === PAGE_SIZE);
        setCreatedPage(page);
      } finally {
        if (!append) setLoading(false);
      }
    },
    [userId, hydrate]
  );

  // ACCEPTED tab: dates where the viewer is the recipient and status='accepted'
  const loadAccepted = useCallback(
    async (page = 1, append = false) => {
      if (!userId) return;
      if (!append) setLoading(true);
      try {
        // 1) Get my accepted date_requests, joined to the dates row.
        // Requires FK date_requests.date_id -> dates.id (standard).
        const { data: drs, error } = await supabase
          .from('date_requests')
          .select(`
            id,
            status,
            date_id,
            updated_at,
            requester_id,
            recipient_id,
            dates:date_id (
              id, title, location, event_date, event_type, who_pays, orientation_preference,
              profile_photo, photo_urls, creator, spots, preferred_gender_counts, remaining_gender_counts
            )
          `)
          .eq('recipient_id', userId)
          .eq('status', 'accepted')
          .order('updated_at', { ascending: false })
          .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

        if (error) {
          console.error('[MyDatesScreen] loadAccepted:', error.message);
          return;
        }

        const dateIds = (drs || []).map(r => r.date_id);
        // 2) Aggregate all accepted attendees for these dates
        let accMap = new Map<string, UUID[]>();
        if (dateIds.length) {
          const { data: accRows, error: accErr } = await supabase
            .from('date_requests')
            .select('date_id, recipient_id')
            .in('date_id', dateIds)
            .eq('status', 'accepted');
          if (!accErr && accRows) {
            for (const r of accRows) {
              const list = accMap.get(r.date_id) || [];
              if (!list.includes(r.recipient_id)) list.push(r.recipient_id);
              accMap.set(r.date_id, list);
            }
          }
        }

        // 3) Build DateRow shape + attach req_id (for Cancel)
        const asDateRows: AcceptedItem[] = (drs || []).map((row: any) => {
          const d = row.dates || {};
          const base: DateRow = {
            id: d.id,
            title: d.title,
            location: d.location,
            event_date: d.event_date,
            event_type: d.event_type,
            who_pays: d.who_pays,
            orientation_preference: d.orientation_preference || [],
            profile_photo: d.profile_photo,
            photo_urls: d.photo_urls || [],
            creator: d.creator,
            accepted_users: accMap.get(d.id) ?? [],
            spots: d.spots,
            preferred_gender_counts: d.preferred_gender_counts || {},
            remaining_gender_counts: d.remaining_gender_counts || {},
          };
          return { ...base, req_id: row.id };
        });

        // 4) Hydrate with profiles and force viewer to be 3rd avatar
        const hydrated = (await hydrate(asDateRows, userId)) as AcceptedItem[];

        setAccepted(prev => (append ? [...prev, ...hydrated] : hydrated));
        setAcceptedHasMore((drs || []).length === PAGE_SIZE);
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

  // Pull‑to‑refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    (tab === 'created' ? loadCreated(1, false) : loadAccepted(1, false)).finally(() =>
      setRefreshing(false)
    );
  }, [tab, loadCreated, loadAccepted]);

  // Realtime refresh when date_requests change (covers accept/cancel/rescind and attendee changes)
  useEffect(() => {
    const ch = supabase
      .channel('mydates-accepted-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'date_requests' }, () => {
        if (tab === 'accepted') loadAccepted(1, false);
        else loadCreated(1, false);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tab, loadAccepted, loadCreated]);

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

  // Actions for Accepted tab
  const onCancelAccepted = useCallback(async (reqId: string) => {
    try {
      const { error } = await supabase.rpc('invites_decide', {
        p_req_id: reqId,
        p_decision: 'cancelled',
      });
      if (error) throw error;
      // Optimistic prune; realtime will also backfill
      setAccepted(prev => prev.filter(r => r.req_id !== reqId));
    } catch (e: any) {
      Alert.alert('Cancel failed', e?.message ?? 'Unable to cancel this date.');
    }
  }, []);

  const onOpenChat = useCallback(async (dateId: string) => {
    try {
      // Ensure the room exists (idempotent); triggers already add/remove membership.
      await supabase.rpc('ensure_date_room', { p_date_id: dateId }).catch(() => null);
      navigation.navigate('GroupChat', { dateId });
    } catch (e: any) {
      Alert.alert('Chat', e?.message ?? 'Unable to open chat.');
    }
  }, [navigation]);

  const onInviteFriends = useCallback((dateId: string) => {
    const ok = smartNavigate(['InviteFriends', 'Invite', 'AddGuests'], { dateId });
    if (!ok) {
      // Fallback: if your Feed has the invite flow, route there and pass dateId
      smartNavigate(['Dates', 'InviteFriends' as any], { dateId });
    }
  }, [smartNavigate]);

  // ---------- Derived UI ----------
  const data = tab === 'created' ? created : accepted;

  // ---------- Header sizes ----------
  const HEADER_BAR_HEIGHT = 48; // touch-friendly
  const HEADER_H = insets.top + HEADER_BAR_HEIGHT;

  // ---------- Render ----------
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
            keyExtractor={(item: any) => String(item.id ?? item.req_id)}
            renderItem={({ item }) => (
              <View style={{ paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' }}>
                <DateCard
                  date={item}
                  userId={userId!}
                  context={tab === 'created' ? 'MY_CREATED' : 'MY_ACCEPTED'}
                  isAccepted={tab === 'accepted'}
                  onChat={() => onOpenChat(item.id)}
                  onChanged={(ev: 'removed' | 'updated') => {
                    if (ev === 'removed') {
                      if (tab === 'created') setCreated(prev => prev.filter((d: any) => d.id !== item.id));
                      else setAccepted(prev => prev.filter((d: any) => d.id !== item.id));
                    }
                  }}
                />

                {/* Accepted‑only action row (Chat / Invite Friends / Cancel) */}
                {tab === 'accepted' && (
                  <View style={{ flexDirection: 'row', marginTop: 8, gap: 8, paddingHorizontal: 16 }}>
                    <PrimaryButton label="Chat" onPress={() => onOpenChat(item.id)} />
                    <SecondaryButton label="Invite Friends" onPress={() => onInviteFriends(item.id)} />
                    <DangerButton label="Cancel" onPress={() => onCancelAccepted((item as AcceptedItem).req_id)} />
                  </View>
                )}
              </View>
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

/** Buttons */
const PrimaryButton = ({ label, onPress }: any) => (
  <TouchableOpacity onPress={onPress} style={{ backgroundColor: '#111827', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }}>
    <Text style={{ color: 'white', fontWeight: '600' }}>{label}</Text>
  </TouchableOpacity>
);
const SecondaryButton = ({ label, onPress }: any) => (
  <TouchableOpacity onPress={onPress} style={{ backgroundColor: '#E5E7EB', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }}>
    <Text style={{ color: '#111827', fontWeight: '600' }}>{label}</Text>
  </TouchableOpacity>
);
const DangerButton = ({ label, onPress }: any) => (
  <TouchableOpacity onPress={onPress} style={{ backgroundColor: '#FEE2E2', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }}>
    <Text style={{ color: '#B91C1C', fontWeight: '700' }}>{label}</Text>
  </TouchableOpacity>
);

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
