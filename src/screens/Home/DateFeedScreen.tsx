// Enhanced DateFeedScreen with filter panel visible and debugging removed
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, TextInput, ScrollView
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import DateCard from '@components/cards/DateCard';
import ShimmerPlaceHolder from 'react-native-shimmer-placeholder';
import Animated, { FadeInUp } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CustomLocationInput from '@components/CustomLocationInput';

const DRYNKS_WHITE = '#FFFFFF';
const DRYNKS_GRAY = '#F5F5F5';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_RED = '#E34E5C';

const distanceOptions = ['25', '50', '100', '250', 'nationwide', 'worldwide'];
const sortOptions = ['Newest', 'Oldest', 'Upcoming'];

const DateFeedScreen = () => {
  const [locationName, setLocationName] = useState('');
  const navigation = useNavigation();
  const [profile, setProfile] = useState(null);
  const [overrideCoords, setOverrideCoords] = useState(null);
  const [userId, setUserId] = useState(null);
  const [dates, setDates] = useState([]);
  const [visibleDates, setVisibleDates] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showFilter, setShowFilter] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [radius, setRadius] = useState('25');
  const [sortBy, setSortBy] = useState('Newest');
  const [selectedTypes, setSelectedTypes] = useState(['group', 'one-on-one']);

  const pageSize = 10;

  const toggleType = (type) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const loadUserAndProfile = async () => {
    try {
      const { data: sessionData, error } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) return;
      setUserId(uid);
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', uid).single();
      setProfile(profileData);
    } catch (error) {
      console.error('[Profile Load Error]', error);
    }
  };

  const loadDates = async (uid) => {
    try {
      setLoading(true);
      const { latitude, longitude } = profile || {};
      const coords = overrideCoords || (latitude && longitude ? { lat: latitude, lng: longitude } : null);
      const radiusValue = isNaN(parseFloat(radius)) ? 20000 : parseFloat(radius) * 1.60934;

      if (coords) {
        const { data, error } = await supabase.rpc('get_dates_nearby_full', {
          lat: coords.lat,
          lng: coords.lng,
          radius_km: radiusValue,
          user_id: uid
        });

        if (error) throw error;

        let filtered = (data || []).filter(d => {
          const matchesOrientation = !d.orientation_preference || (profile.orientation && d.orientation_preference.includes(profile.orientation));
          return (
            d.status === 'open' &&
            matchesOrientation &&
            ((selectedTypes.includes('group') && d.spots > 2) ||
              (selectedTypes.includes('one-on-one') && d.spots === 2)) &&
            d.location?.toLowerCase().includes(filterText.toLowerCase())
          );
        });

        if (sortBy === 'Newest') {
          filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } else if (sortBy === 'Oldest') {
          filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        } else if (sortBy === 'Upcoming') {
          filtered.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
        }

        setDates(filtered);
      } else {
        setDates([]);
      }
    } catch (error) {
      console.error('[Dates Load Error]', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserAndProfile();
    (async () => {
      const storedSort = await AsyncStorage.getItem('sortBy');
      const storedFilter = await AsyncStorage.getItem('filterText');
      const storedRadius = await AsyncStorage.getItem('radius');
      if (storedFilter) setFilterText(storedFilter);
      if (storedRadius) setRadius(storedRadius);
    })();
  }, []);

  useEffect(() => { if (userId) loadDates(userId); }, [userId, filterText, selectedTypes, radius, overrideCoords, sortBy]);
  useEffect(() => { AsyncStorage.setItem('radius', radius);
    AsyncStorage.setItem('filterText', filterText);
    AsyncStorage.setItem('sortBy', sortBy); }, [radius, filterText]);
  useEffect(() => { setVisibleDates(dates.slice(0, page * pageSize)); }, [dates, page]);

  const handleLoadMore = () => {
    if (page * pageSize < dates.length) {
      setPage(prev => prev + 1);
    }
  };

  const renderDateCard = useCallback(
    ({ item, index }) => (
      <Animated.View entering={FadeInUp.delay(index * 50).duration(300)}>
        <DateCard
          date={item}
          userId={profile?.id}
          isCreator={item.creator === profile?.id}
          isAccepted={item.accepted_users?.includes(profile?.id)}
          showChat={true}
          disabled={item.accepted_users?.length >= item.spots}
          onTap={() => {}}
          onAccept={() => {}}
          onDecline={() => {}}
          onInvite={() => {}}
          onChat={() => {}}
        />
      </Animated.View>
    ),
    [profile]
  );

  return (
    <AnimatedScreenWrapper showLogo={false}>
      <View style={styles.filterBar}>
        <TouchableOpacity onPress={() => setShowFilter(!showFilter)}>
          <Text style={styles.filterToggleText}>✨ Filters & Sort ▾</Text>
        </TouchableOpacity>
      </View>

      {showFilter && (
        <Animated.View entering={FadeInUp} style={styles.filterPanel}>
          <TextInput
            style={styles.input}
            value={filterText}
            onChangeText={setFilterText}
            placeholder="Search city or venue..."
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {distanceOptions.map(option => (
              <TouchableOpacity
                key={option}
                onPress={() => setRadius(option)}
                style={[styles.chip, radius === option && styles.chipActive]}
              >
                <Text style={radius === option ? styles.chipTextActive : styles.chipText}>{option} mi</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {['group', 'one-on-one'].map(option => (
              <TouchableOpacity
                key={option}
                onPress={() => toggleType(option)}
                style={[styles.chip, selectedTypes.includes(option) && styles.chipActive]}
              >
                <Text style={selectedTypes.includes(option) ? styles.chipTextActive : styles.chipText}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {sortOptions.map(option => (
              <TouchableOpacity
                key={option}
                onPress={() => setSortBy(option)}
                style={[styles.chip, sortBy === option && styles.chipActive]}
              >
                <Text style={sortBy === option ? styles.chipTextActive : styles.chipText}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {loading ? (
        <View style={{ margin: 16 }}>
          {[...Array(3)].map((_, i) => (
            <ShimmerPlaceHolder key={i} style={{ height: 120, borderRadius: 12, marginVertical: 8 }} />
          ))}
        </View>
      ) : dates.length === 0 ? (
        <View style={styles.ctaContainer}>
          <Text style={styles.ctaText}>Looks like you're the pioneer here 🚀{"\n"}Be the first to spark something magical.</Text>
          <TouchableOpacity onPress={() => navigation.navigate('New Date')} style={styles.ctaButton}>
            <Text style={styles.ctaButtonText}>Create a Date Now</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={visibleDates}
          keyExtractor={d => d.id}
          renderItem={renderDateCard}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => userId && loadDates(userId)} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
        />
      )}
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  filterBar: { padding: 16, borderBottomWidth: 1, borderColor: '#eee' },
  filterToggleText: { fontWeight: '600', color: DRYNKS_BLUE, fontSize: 16 },
  filterPanel: { paddingHorizontal: 16, paddingBottom: 12 },
  input: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8,
    backgroundColor: '#fff', marginBottom: 12,
  },
  chipRow: { flexDirection: 'row', marginBottom: 8 },
  chip: {
    backgroundColor: '#eee', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, marginRight: 8,
  },
  chipActive: { backgroundColor: DRYNKS_RED },
  chipText: { color: DRYNKS_BLUE, fontSize: 13 },
  chipTextActive: { color: DRYNKS_WHITE, fontWeight: '600', fontSize: 13 },
  ctaContainer: { padding: 24, alignItems: 'center' },
  ctaText: { fontSize: 16, textAlign: 'center', marginBottom: 16, color: DRYNKS_BLUE },
  ctaButton: {
    backgroundColor: DRYNKS_RED,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  ctaButtonText: {
    color: DRYNKS_WHITE,
    fontWeight: '600',
    fontSize: 16,
  },
});

export default DateFeedScreen;
