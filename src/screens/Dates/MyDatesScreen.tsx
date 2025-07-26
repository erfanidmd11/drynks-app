// MyDatesScreen.tsx – Final Production Ready with Full Debug Logging
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import AppShell from '@components/AppShell';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#FFFFFF';
const DRYNKS_WHITE = '#FFFFFF';

const FILTERS = ['Created', 'Accepted', 'Pending'];

const MyDatesScreen = () => {
  const [dateRequests, setDateRequests] = useState([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeFilters, setActiveFilters] = useState(FILTERS);
  const [showPastDates, setShowPastDates] = useState(false);
  const navigation = useNavigation();

  const fetchDateRequests = useCallback(async () => {
    console.log('[MyDatesScreen] Fetching date requests...');
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      console.log('[Logged in as]', user.id);

      const quotedId = `"${user.id}"`;
      const { data, error } = await supabase
        .from('date_requests')
        .select('*')
        .or(`creator.eq.${user.id},accepted_users.cs.{${quotedId}},declined_users.cs.{${quotedId}},pending_users.cs.{${quotedId}}`)
        .order('event_date');

      if (error) {
        console.error('[Fetch Date Requests Error]', error);
        Alert.alert('Error', 'Failed to load dates.');
      } else {
        setDateRequests(data);
        console.log('[Fetched dateRequests]', data);
      }
    } catch (err) {
      console.error('[Fetch Error]', err);
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDateRequests();
  }, [fetchDateRequests]);

  const toggleFilter = (filter) => {
    setActiveFilters((prev) =>
      prev.includes(filter) ? prev.filter(f => f !== filter) : [...prev, filter]
    );
  };

  const filteredDates = dateRequests.filter(item => {
    const isCreator = item.creator === userId;
    const isAccepted = item.accepted_users?.includes(userId);
    const isPending = item.pending_users?.includes(userId);
    const isPast = new Date(item.event_date) < new Date();

    const matchesFilter = (
      (activeFilters.includes('Created') && isCreator) ||
      (activeFilters.includes('Accepted') && isAccepted) ||
      (activeFilters.includes('Pending') && isPending)
    );

    return showPastDates ? matchesFilter && isPast : matchesFilter && !isPast;
  });

  const renderItem = ({ item }) => {
    const accepted = item.accepted_users?.includes(userId);
    const declined = item.declined_users?.includes(userId);
    const pending = item.pending_users?.includes(userId);

    const eventDate = item.event_date
      ? new Date(item.event_date).toLocaleDateString()
      : 'No Date';

    return (
      <Animated.View entering={FadeInUp.duration(400)}>
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('DateDetails', { dateId: item.id })}
        >
          <View style={styles.infoWrap}>
            <Text style={styles.title}>{item.title || 'Untitled'}</Text>
            <Text style={styles.subtitle}>{`${item.location || ''} • ${eventDate}`}</Text>
          </View>
          {accepted ? (
            <Ionicons name="checkmark-circle" size={26} color={DRYNKS_RED} />
          ) : declined ? (
            <Ionicons name="close-circle" size={26} color="gray" />
          ) : pending ? (
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => {}}>
                <Ionicons name="close" size={26} color="gray" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {}}>
                <Ionicons name="checkmark" size={26} color={DRYNKS_RED} />
              </TouchableOpacity>
            </View>
          ) : (
            <Ionicons name="help-circle-outline" size={26} color="gray" />
          )}
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <AppShell currentTab="My DrYnks">
      <View style={{ padding: 12 }}>
        <Text style={{ fontSize: 12, color: 'gray' }}>🛠 Debug: Logged in as: {userId || 'unknown'}</Text>
        <Text style={{ fontSize: 12, color: 'gray' }}>🗓 Total dateRequests: {dateRequests.length}</Text>
        <Text style={{ fontSize: 12, color: 'gray' }}>✅ Active Filters: {activeFilters.join(', ')}</Text>
        <Text style={{ fontSize: 12, color: 'gray' }}>⏳ Show Past Dates: {showPastDates ? 'Yes' : 'No'}</Text>
      </View>

      <View style={styles.filterBar}>
        {FILTERS.map(filter => (
          <TouchableOpacity key={filter} onPress={() => toggleFilter(filter)} style={[styles.filterBtn, activeFilters.includes(filter) && styles.filterActive]}>
            <Text style={styles.filterText}>{filter}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setShowPastDates(prev => !prev)} style={[styles.filterBtn, showPastDates && styles.filterActive]}>
          <Text style={styles.filterText}>Past Dates</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={DRYNKS_RED} />
        </View>
      ) : filteredDates.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No matching DrYnks yet. Adjust your filters or check back later.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredDates}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchDateRequests} />}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listWrap}
        />
      )}
    </AppShell>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  emptyText: {
    fontSize: 16,
    color: DRYNKS_BLUE,
    textAlign: 'center',
    lineHeight: 22,
  },
  listWrap: {
    paddingBottom: 80,
    paddingTop: 10,
  },
  card: {
    backgroundColor: DRYNKS_WHITE,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  infoWrap: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: DRYNKS_BLUE,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  filterBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 10,
    paddingHorizontal: 16,
    flexWrap: 'wrap',
  },
  filterBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#eee',
    marginBottom: 8,
  },
  filterActive: {
    backgroundColor: DRYNKS_RED,
  },
  filterText: {
    color: DRYNKS_BLUE,
    fontWeight: '600',
  },
});

export default MyDatesScreen;
