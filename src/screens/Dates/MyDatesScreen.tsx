// MyDatesScreen.tsx — Production Ready (Created & Accepted only, with MyDates actions)

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';

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
  location: string | null; // may be city or WKT/hex
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
const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(s || ''));

const MyDatesScreen: React.FC = () => {
  const navigation = useNavigation<any>();

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

  // Bootstrap session
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

  const loadCreated = useCallback(async (page = 1, append = false) => {
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
  }, [userId, hydrate]);

  const loadAccepted = useCallback(async (page = 1, append = false) => {
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
  }, [userId, hydrate]);

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

  return (
    <AppShell currentTab="My DrYnks">
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
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
  <>
    {/* keep your variant without breaking TS */}
    <DateCard
      date={item}
      userId={userId!}
      isCreator={tab === 'created'}
      isAccepted={tab === 'accepted'}
      {...({ variant: 'mydates' } as any)}
      onCancel={async () => {
        try {
          if (tab === 'created') {
            // Creator cancels: delete the whole date
            const { error } = await supabase.from('date_requests').delete().eq('id', item.id);
            if (error) throw error;
            setCreated(prev => prev.filter(d => d.id !== item.id));
          } else {
            // Guest cancels: leave the date (remove your id from accepted_users)
            const { data: row } = await supabase
              .from('date_requests')
              .select('accepted_users')
              .eq('id', item.id)
              .single();

            const next = (row?.accepted_users || []).filter((id: string) => id !== userId);
            const { error } = await supabase
              .from('date_requests')
              .update({ accepted_users: next })
              .eq('id', item.id);
            if (error) throw error;
            setAccepted(prev => prev.filter(d => d.id !== item.id));
          }
        } catch (e) {
          console.warn('[Cancel error]', e);
        }
      }}
      onOpenChat={() => {
        navigation.navigate('DateChat', { dateId: item.id });
      }}
    />
  </>
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
    </AppShell>
  );
};

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#E7EBF0',
  },
  chipActive: {
    backgroundColor: '#232F39',
  },
  chipText: { color: '#23303A', fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  empty: {
    textAlign: 'center',
    color: '#8C97A4',
    padding: 24,
  },
});

export default MyDatesScreen;
