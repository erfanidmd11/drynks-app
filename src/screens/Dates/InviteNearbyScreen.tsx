// InviteNearbyScreen.tsx – Final Version with Photo Indicators and Enhanced Filters
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image
} from 'react-native';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import ProfileCard from '@components/cards/ProfileCard';
import ProfileCardSkeleton from '@components/cards/ProfileCardSkeleton';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';
const PAGE_SIZE = 10;
const DISTANCE_OPTIONS = [25, 50, 100, 150, 200, 250, 450, 10000];

const InviteNearbyScreen = () => {
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [radius, setRadius] = useState(402.336);

  const navigation = useNavigation();
  const route = useRoute();
  const { eventLocation, genderPrefs, orientationPref, dateId } = route.params;

  useEffect(() => {
    fetchLoggedInUser();
  }, []);

  useEffect(() => {
    if (!loggedInUser) return;
    fetchUsersNearby(0);
  }, [loggedInUser, radius]);

  const fetchLoggedInUser = async () => {
    const { data: session } = await supabase.auth.getUser();
    setLoggedInUser(session?.user);
  };

  const fetchUsersNearby = async (pageNumber) => {
    try {
      setLoading(true);
      const selectedGenders = Object.keys(genderPrefs).filter(k => parseInt(genderPrefs[k] || '0') > 0);
      const { data, error } = await supabase.rpc('get_users_nearby_event', {
        lat: eventLocation.latitude,
        lng: eventLocation.longitude,
        radius_km: radius,
        user_id: loggedInUser.id,
        date_id: dateId || '00000000-0000-0000-0000-000000000000',
        range_start: pageNumber * PAGE_SIZE,
        range_end: (pageNumber + 1) * PAGE_SIZE - 1,
        orientation_prefs: orientationPref,
        gender_prefs: selectedGenders,
      });
      if (error) throw error;
      if (data.length < PAGE_SIZE) setHasMore(false);
      setUsers(prev => [...prev, ...data]);
      setPage(pageNumber);
    } catch (err) {
      console.error('❌ Filtered fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      fetchUsersNearby(page + 1);
    }
  };

  const handleShareInvite = () => {
    Clipboard.setStringAsync('https://drnksapp.com/invite');
    Linking.openURL('sms:&body=Join me on DrYnks: https://drnksapp.com/invite');
    Alert.alert('Invite Copied', 'You can paste it anywhere or send directly via text.');
  };

  const handleDone = () => {
    navigation.navigate('My DrYnks');
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <ProfileCard user={item} onInvite={() => Alert.alert('Invite sent to', item.screenname)} />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { backgroundColor: DRYNKS_WHITE }]}> 
        <Image source={require('../../../assets/images/DrYnks_Y_logo.png')} style={styles.logo} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.radiusBar}>
        {DISTANCE_OPTIONS.map(opt => {
          const isSelected = radius === (opt === 10000 ? 10000 : opt * 1.60934);
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => {
                setUsers([]);
                setHasMore(true);
                setPage(0);
                setRadius(isSelected ? radius : opt === 10000 ? 10000 : opt * 1.60934);
              }}
              style={[styles.radiusOption, isSelected && styles.radiusSelected]}
            >
              <Text style={[styles.radiusText, isSelected && { color: DRYNKS_WHITE }]}> {opt === 10000 ? 'Nationwide' : `${opt} mi`} </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading && users.length === 0 ? (
        <View style={{ padding: 16 }}>
          {[...Array(3)].map((_, i) => <ProfileCardSkeleton key={i} />)}
        </View>
      ) : users.length === 0 ? (
        <View style={{ padding: 24, marginTop: 12, backgroundColor: '#fefefe', borderRadius: 12 }}>
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
          keyExtractor={item => item.id}
          renderItem={renderItem}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        />
      )}

      <TouchableOpacity style={styles.inviteButton} onPress={handleShareInvite}>
        <Text style={styles.buttonText}>Invite via Text</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
        <Text style={styles.buttonText}>Done</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DRYNKS_WHITE },
  header: {
  justifyContent: 'center',
  alignItems: 'center',
  paddingVertical: 16,
  borderBottomWidth: 1,
  borderBottomColor: '#ddd',
  backgroundColor: DRYNKS_WHITE,
},
headerText: {
  fontSize: 18,
  fontWeight: 'bold',
  marginTop: 8,
},
logo: {
  width: 48,
  height: 48,
  resizeMode: 'contain',
},
radiusBar: {
  paddingVertical: 12,
  paddingHorizontal: 16,
  flexDirection: 'row',
  alignItems: 'center',
},
radiusOption: {
  paddingVertical: 12,
  paddingHorizontal: 24,
  borderRadius: 24,
  borderColor: DRYNKS_BLUE,
  borderWidth: 1,
  marginRight: 8,
},
radiusSelected: {
  backgroundColor: DRYNKS_BLUE,
},
radiusText: {
  fontSize: 15,
  color: DRYNKS_BLUE,
  lineHeight: 20,
},
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
buttonText: {
  color: DRYNKS_WHITE,
  fontWeight: '600',
  fontSize: 16,
},
});

export default InviteNearbyScreen;
