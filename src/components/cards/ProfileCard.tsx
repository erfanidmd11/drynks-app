// ProfileCard.js – Final Version with Vertical Image, Overlay Info, Golden Ratio Sizing
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  ImageBackground,
  TouchableOpacity,
  Animated
} from 'react-native';

const { width } = Dimensions.get('window');
const GOLDEN_RATIO = 1.618;
const CARD_WIDTH = width - 32;
const CARD_HEIGHT = CARD_WIDTH * GOLDEN_RATIO;

const calculateAge = (dob) => {
  if (!dob) return 'N/A';
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

const ProfileCard = ({ user, onInvite }) => {
  const photos = [user.profile_photo, ...(user.gallery_photos || [])].filter(Boolean);
  const age = calculateAge(user.birthdate);
  const distanceMiles = user.distance_km ? Math.round(user.distance_km * 0.621371) : null;

  const renderPhoto = ({ item }) => (
    <ImageBackground source={{ uri: item }} style={styles.photo} imageStyle={styles.imageStyle}>
      <View style={styles.overlay}>
        <Text style={styles.name}>{user.screenname || 'Unknown'}, {age}</Text>
        <Text style={styles.detail}>{user.gender || '-'} • {user.orientation || '-'}</Text>
        <Text style={styles.detail}>Into: {(user.preferences || []).join(', ') || '-'}</Text>
        <Text style={styles.detail}>{user.location || '-'}{distanceMiles ? ` • ${distanceMiles} mi` : ''}</Text>
      </View>
    </ImageBackground>
  );

  return (
    <View style={styles.card}>
      <FlatList
        data={photos}
        renderItem={renderPhoto}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, idx) => `${item}_${idx}`}
      />
      <TouchableOpacity onPress={onInvite} style={styles.inviteButton}>
        <Text style={styles.inviteText}>Invite</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT + 50,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
    elevation: 4,
    marginBottom: 20,
  },
  photo: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    justifyContent: 'flex-end',
  },
  imageStyle: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 12,
  },
  name: {
    fontSize: 22,
    color: 'white',
    fontWeight: 'bold',
  },
  detail: {
    color: '#eee',
    fontSize: 13,
    marginTop: 2,
  },
  inviteButton: {
    backgroundColor: '#E34E5C',
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  inviteText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default ProfileCard;
