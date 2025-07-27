// Cleaned and corrected production-ready version of DateFeedScreen

import React, { useState, useEffect, useCallback } from 'react';
import { PanGestureHandler } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedGestureHandler, withSpring, runOnJS, FadeInUp } from 'react-native-reanimated';
import {
  View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, TextInput, ScrollView, Dimensions
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import DateCard from '@components/cards/DateCard';
import ShimmerPlaceHolder from 'react-native-shimmer-placeholder';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CustomLocationInput from '@components/CustomLocationInput';

const DRYNKS_WHITE = '#FFFFFF';
const DRYNKS_GRAY = '#F5F5F5';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_RED = '#E34E5C';

const distanceOptions = ['25', '50', '100', '250', 'nationwide', 'worldwide'];
const sortOptions = ['Newest', 'Oldest', 'Upcoming'];
const dateStateOptions = ['All Dates', 'Active Dates', 'Past/Filled Dates'];
const { width } = Dimensions.get('window');

const DateFeedScreen = () => {
  const [locationName, setLocationName] = useState('');
  const navigation = useNavigation();
  const [profile, setProfile] = useState(null);
  const [overrideCoords, setOverrideCoords] = useState(null);
  const [userId, setUserId] = useState(null);
  const [dates, setDates] = useState([]);
  const [visibleDates, setVisibleDates] = useState([]);
  const [dismissedDateIds, setDismissedDateIds] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [radius, setRadius] = useState('250');
  const [sortBy, setSortBy] = useState('Newest');
  const [dateStateFilter, setDateStateFilter] = useState('All Dates');
  const [selectedTypes, setSelectedTypes] = useState(['group', 'one-on-one']);

  const pageSize = 10;

  const toggleType = (type) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const loadUserAndProfile = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      let uid = sessionData?.session?.user?.id;

      if (!uid) {
        console.warn('No session found, retrying...');
        retryCountRef.current++;
        if (retryCountRef.current > 5) {

          console.warn('Retry limit exceeded. Aborting.');
          return;
        }
        setTimeout(loadUserAndProfile, 1000);
        return;
      }

      setUserId(uid);
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', uid).single();
      setProfile(profileData);

      if (!overrideCoords) {
        setLocationName(profileData.location || '');
      } else {
        setLocationName(`${overrideCoords.name}`);
      }
    } catch (error) {
      console.error('[Profile Load Error]', error);
    }
  }, [overrideCoords]);

  const loadDates = useCallback(async (uid) => {
    if (!profile) return;
    try {
      setLoading(true);
      const { latitude, longitude } = profile || {};
      const coords = overrideCoords || (latitude && longitude ? { lat: latitude, lng: longitude } : null);
      const radiusValue = isNaN(parseFloat(radius)) ? 20000 : parseFloat(radius) * 1.60934;

      if (!coords) {
        setDates([]);
        return;
      }

      const { data, error } = await supabase.rpc('get_dates_nearby_full', {
        lat: coords.lat,
        lng: coords.lng,
        radius_km: radiusValue,
        user_id: uid
      });

      if (error) throw error;

      const active = [], pastOrFilled = [];
      (data || []).forEach(d => {
        const matchesOrientation = !d.orientation_preference || (profile?.orientation && d.orientation_preference.includes(profile.orientation));
        const notDismissed = !dismissedDateIds.includes(d.id);

        const isPast = new Date(d.event_date) < new Date();
        const isFull = d.accepted_users?.length >= d.spots;

        const valid = (
          matchesOrientation &&
          notDismissed &&
          ((selectedTypes.includes('group') && d.spots > 2) ||
            (selectedTypes.includes('one-on-one') && d.spots === 2)) &&
          d.location?.toLowerCase().includes(filterText.toLowerCase())
        );

        if (!valid) return;

        if (dateStateFilter === 'Active Dates') {
          if (!isPast && !isFull && d.status === 'open') active.push(d);
        } else if (dateStateFilter === 'Past/Filled Dates') {
          if (isPast || isFull) pastOrFilled.push(d);
        } else {
          if (!isPast && !isFull && d.status === 'open') active.push(d);
          else pastOrFilled.push(d);
        }
      });

      let filtered = [...active, ...pastOrFilled];

      if (sortBy === 'Newest') {
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      } else if (sortBy === 'Oldest') {
        filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      } else if (sortBy === 'Upcoming') {
        filtered.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
      }

      setDates(filtered);
    } catch (error) {
      console.error('[Dates Load Error]', error);
    } finally {
      setLoading(false);
    }
  }, [profile, overrideCoords, radius, sortBy, dismissedDateIds, selectedTypes, filterText, dateStateFilter]);

  useEffect(() => {
    loadUserAndProfile();
    (async () => {
      const storedSort = await AsyncStorage.getItem('sortBy');
      const storedFilter = await AsyncStorage.getItem('filterText');
      const storedRadius = await AsyncStorage.getItem('radius');
      if (storedFilter) setFilterText(storedFilter);
      if (storedRadius) setRadius(storedRadius);
      if (storedSort) setSortBy(storedSort);
    })();
  }, [loadUserAndProfile]);

  useEffect(() => { if (userId) loadDates(userId); }, [userId, loadDates]);
  useEffect(() => {
    AsyncStorage.setItem('radius', radius);
    AsyncStorage.setItem('filterText', filterText);
    AsyncStorage.setItem('sortBy', sortBy);
  }, [radius, filterText, sortBy]);
  useEffect(() => {
    setVisibleDates(dates.slice(0, page * pageSize));
  }, [dates, page]);

  const handleLoadMore = () => {
    if (page * pageSize < dates.length) {
      setPage(prev => prev + 1);
    }
  };

  const handleDismiss = useCallback((id) => {
    setDismissedDateIds(prev => [...prev, id]);
  }, []);

  function renderDateCard({ item, index }) {
    const translateX = useSharedValue(0);
    const threshold = 100;

    const gestureHandler = useAnimatedGestureHandler({
      onActive: (event) => {
        translateX.value = event.translationX;
      },
      onEnd: (event) => {
        if (event.translationX < -threshold) {
          translateX.value = withSpring(-width, {}, () => runOnJS(handleDismiss)(item.id));
        } else {
          translateX.value = withSpring(0);
        }
      }
    });

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: translateX.value }]
    }));

    return (
      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View entering={FadeInUp.delay(index * 50).duration(300)} style={animatedStyle}>
          <DateCard
            date={item}
            userId={profile?.id}
            isCreator={item.creator === profile?.id}
            isAccepted={item.accepted_users?.includes(profile?.id)}
            showChat={true}
            disabled={item.accepted_users?.length >= item.spots}
            onTap={() => {}}
            onAccept={() => {}}
            onDecline={() => handleDismiss(item.id)}
            onInvite={() => {}}
            onChat={() => {}}
          />
        </Animated.View>
      </PanGestureHandler>
    );
  }, [profile, handleDismiss]);

  const retryCountRef = useRef(0);


  return (
    <AnimatedScreenWrapper showLogo={false}>
      <View style={styles.filterBar}>
        <Text style={{ fontSize: 12, color: DRYNKS_BLUE, marginBottom: 6 }}>📍 Location: {locationName || 'Loading...'}</Text>
        <TouchableOpacity onPress={() => setShowFilter(!showFilter)}>
          <Text style={styles.filterToggleText}>✨ Filters & Sort ▾</Text>
        </TouchableOpacity>
      </View>

      {showFilter && (
        <Animated.View entering={FadeInUp} style={styles.filterPanel}>
          <Text style={styles.label}>Search Location</Text>
          <TextInput
            style={styles.input}
            value={filterText}
            onChangeText={setFilterText}
            placeholder="Enter a city or venue..."
          />

          <Text style={styles.label}>Search Radius (mi)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {distanceOptions.map(option => (
              <TouchableOpacity
                key={option}
                onPress={() => setRadius(option)}
                style={[styles.chip, radius === option && styles.chipActive]}
              >
                <Text style={radius === option ? styles.chipTextActive : styles.chipText}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Event Type</Text>
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

          <Text style={styles.label}>Show</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {dateStateOptions.map(option => (
              <TouchableOpacity
                key={option}
                onPress={() => setDateStateFilter(option)}
                style={[styles.chip, dateStateFilter === option && styles.chipActive]}
              >
                <Text style={dateStateFilter === option ? styles.chipTextActive : styles.chipText}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            onPress={() => {
              setFilterText('');
              setRadius('250');
              setSortBy('Newest');
              setSelectedTypes(['group', 'one-on-one']);
              setDateStateFilter('All Dates');
              setOverrideCoords(null);
            }}
            style={{ marginTop: 12, alignSelf: 'flex-start', backgroundColor: DRYNKS_GRAY, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }}
          >
            <Text style={{ color: DRYNKS_BLUE, fontWeight: '600' }}>Reset Filters</Text>
          </TouchableOpacity>

          <Text style={styles.label}>Sort By</Text>
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
          <Text style={styles.ctaText}>
            Looks like you're the pioneer here 🚀 Be the first to spark something magical.
        </Text>
          <TouchableOpacity onPress={() => navigation.navigate('New Date')} style={styles.ctaButton}>
            <Text style={styles.ctaButtonText}>Create a Date Now</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={visibleDates}
          keyExtractor={d => d.id.toString()}
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
  ctaContainer: {
    marginTop: 40,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  ctaText: {
    fontSize: 16,
    color: DRYNKS_BLUE,
    textAlign: 'center',
    marginBottom: 16,
  },
  ctaButton: {
    backgroundColor: DRYNKS_RED,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
  },
  ctaButtonText: {
    color: DRYNKS_WHITE,
    fontWeight: 'bold',
    fontSize: 16,
  },
  filterBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: DRYNKS_WHITE,
  },
  filterToggleText: {
    fontSize: 14,
    color: DRYNKS_RED,
    fontWeight: '600',
  },
  filterPanel: {
    backgroundColor: DRYNKS_GRAY,
    padding: 16,
    borderBottomColor: '#ccc',
    borderBottomWidth: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    color: DRYNKS_BLUE,
  },
  input: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 14,
    borderColor: '#ccc',
    borderWidth: 1,
  },
  chipRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  chip: {
    backgroundColor: '#ddd',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: DRYNKS_BLUE,
  },
  chipText: {
    fontSize: 12,
    color: '#333',
  },
  chipTextActive: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
});

export default DateFeedScreen;
