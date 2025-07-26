// ProfileDetailsScreen.tsx – Enhanced Profile View with Back to DateCard Support + Animated Slide Transition
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import Animated, { FadeInUp, SlideOutRight, SlideInRight } from 'react-native-reanimated';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const { width } = Dimensions.get('window');

const ProfileDetailsScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { userId } = route.params;
  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUser = sessionData?.session?.user;
      if (sessionUser) setCurrentUser(sessionUser);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (!error) setProfile(data);
      setLoading(false);
    };

    fetchProfile();
  }, [userId]);

  const isOwner = currentUser?.id === userId;

  const handleFlag = () => {
    Alert.alert('Flag Profile', 'Thank you. Our moderation team will review this profile.');
    // Add Supabase logging or webhook call here for moderation
  };

  if (loading || !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={DRYNKS_RED} />
      </View>
    );
  }

  const validGallery = (profile.gallery_photos || []).filter(Boolean);
  const canEditGallery = isOwner && validGallery.length >= 3;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Animated.View entering={SlideInRight.duration(400)} style={{ alignItems: 'center' }}>
        <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        <Text style={styles.screenname}>{profile.screen_name}</Text>
        <Text style={styles.meta}>{profile.age} • {profile.gender} • Likes: {profile.preferences?.join(', ')}</Text>
        <Text style={styles.location}>📍 {profile.city || profile.location || 'Unknown'}</Text>

        {profile.about && (
          <Text style={styles.about}>{profile.about}</Text>
        )}
      </Animated.View>

      <FlatList
        data={validGallery}
        keyExtractor={(uri, i) => `${uri}-${i}`}
        renderItem={({ item }) => <Image source={{ uri: item }} style={styles.photo} />}
        numColumns={3}
        contentContainerStyle={styles.gallery}
      />

      {isOwner ? (
        <TouchableOpacity onPress={() => navigation.navigate('EditProfile')} style={styles.actionButton}>
          <Text style={styles.actionText}>✏️ Edit My Profile</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={handleFlag} style={styles.flagButton}>
          <Text style={styles.flagText}>🚩 Flag This Profile</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.backButton}
      >
        <Animated.Text exiting={SlideOutRight.duration(300)} style={styles.backText}>
          ← Back to Date
        </Animated.Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { alignItems: 'center', padding: 20 },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 10 },
  screenname: { fontSize: 20, fontWeight: 'bold', color: DRYNKS_BLUE },
  meta: { fontSize: 14, color: '#555', marginVertical: 4 },
  location: { fontSize: 14, color: '#777' },
  about: { fontSize: 14, color: '#444', marginVertical: 12, textAlign: 'center' },
  gallery: { marginTop: 10 },
  photo: { width: width / 3 - 12, height: width / 3 - 12, margin: 4, borderRadius: 8 },
  actionButton: {
    marginTop: 24,
    backgroundColor: DRYNKS_RED,
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 30,
  },
  actionText: { color: DRYNKS_WHITE, fontWeight: '600', fontSize: 16 },
  flagButton: {
    marginTop: 24,
    backgroundColor: '#FCDDDD',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  flagText: { color: DRYNKS_RED, fontWeight: '600', fontSize: 14 },
  backButton: { marginTop: 30 },
  backText: { color: DRYNKS_RED, fontSize: 16 },
});

export default ProfileDetailsScreen;
