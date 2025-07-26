// Final DateCard.tsx with Supabase RPC notification integration using fetch

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  FlatList,
  Alert
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';

const { width } = Dimensions.get('window');
const HEIGHT = Math.round(width / 1.618);

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const DateCard = ({ date, userId, isCreator, isAccepted, disabled, onTap, onAccept, onDecline, onInvite, onChat }) => {
  const navigation = useNavigation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const flatListRef = useRef();

  const eventDate = new Date(date?.event_date);
  const isPast = eventDate < new Date();

  const accepted = date.accepted_profiles || [];
  const available = date.preferred_gender_counts || {};
  const remaining = date.remaining_gender_counts || {};

  const gallery = [
    ...(date.profile_photo ? [{ type: 'event', photo: date.profile_photo }] : []),
    date.creator_profile ? { type: 'creator', profile: date.creator_profile } : null,
    ...accepted.filter(p => p).map(p => ({ type: 'accepted', profile: p })),
  ].filter(Boolean);

  const handleScroll = e => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrentIndex(index);
  };

  const notifyServer = async (action) => {
    try {
      const response = await fetch('https://your-api-host/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_id: date.id, actor_id: userId, action })
      });

      if (!response.ok) throw new Error('Notification failed');
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  const handleAccept = async () => {
    await notifyServer('accepted');
    Alert.alert('🎉 Success', 'You’ve joined this date! The host will be notified.');
    onAccept && onAccept();
  };

  const handleRequest = async () => {
    await notifyServer('requested');
    Alert.alert('🎉 Request Sent', 'Your interest has been shared. The host will be notified.');
    onAccept && onAccept();
  };

  const renderItem = ({ item }) => {
    if (item.type === 'event') {
      return (
        <View style={styles.imageWrapper}>
          <Image source={{ uri: item.photo }} style={styles.image} />
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.6)"]} style={styles.overlay} />
          <View style={styles.textOverlay}>
            <Text style={styles.title}>{date.title}</Text>
            <Text style={styles.subtitle}>{date.location} • {eventDate.toDateString()}</Text>
            {date.distance_km && <Text style={styles.subtitle}>{date.distance_km.toFixed(1)} km away</Text>}
            <Text style={styles.meta}>Hosted by: {date.creator_profile?.screen_name}</Text>
            <Text style={styles.meta}>Orientation: {date.orientation_preference?.join(', ')}</Text>
            <Text style={styles.meta}>Availability:</Text>
            {['Female', 'Male', 'TS'].map(g => (
              <Text key={g} style={styles.meta}>
                • {g}: {remaining[g] || 0}/{available[g] || 0}
              </Text>
            ))}
          </View>
        </View>
      );
    } else {
      const p = item.profile;
      if (!p || !p.avatar_url) return null;

      return (
        <TouchableOpacity style={styles.imageWrapper} onPress={() => navigation.navigate('Profile', { userId: p.id })}>
          <Image source={{ uri: p.avatar_url }} style={styles.image} />
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.6)"]} style={styles.overlay} />
          <View style={styles.textOverlay}>
            <Text style={styles.title}>{p.screen_name || 'Unknown'}, {p.age || '?'} </Text>
            <Text style={styles.meta}>{p.location || '—'}</Text>
            <Text style={styles.meta}>{p.gender || '—'} • {p.orientation || '—'}</Text>
            <Text style={styles.meta}>Into: {(p.prefers || []).join(', ') || '—'}</Text>
          </View>
        </TouchableOpacity>
      );
    }
  };

  if (dismissed) return null;

  return (
    <View style={styles.card}>
      <FlatList
        ref={flatListRef}
        horizontal
        pagingEnabled
        snapToAlignment="center"
        decelerationRate="fast"
        data={gallery}
        keyExtractor={(_, i) => i.toString()}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
      />
      <View style={styles.dotsContainer}>
        {gallery.map((_, i) => (
          <View key={i} style={[styles.dot, currentIndex === i && styles.activeDot]} />
        ))}
      </View>

      {!isPast && !disabled && !isAccepted && !isCreator && (
        <View style={styles.buttonRow}>
          <TouchableOpacity onPress={() => setDismissed(true)} style={styles.outlineBtn}>
            <Text style={styles.outlineText}>Not Interested 🙅</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRequest} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>Request to Join 🎉</Text>
          </TouchableOpacity>
        </View>
      )}

      {isAccepted && (
        <TouchableOpacity onPress={onChat} style={[styles.primaryBtn, { alignSelf: 'center' }]}>
          <Text style={styles.primaryText}>Join Chat 💬</Text>
        </TouchableOpacity>
      )}

      {isPast && <Text style={styles.notice}>🍷 This date is in the past</Text>}
      {disabled && !isAccepted && <Text style={styles.notice}>🙅 This date is full</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: DRYNKS_WHITE,
    borderRadius: 20,
    marginVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  imageWrapper: {
    width,
    height: HEIGHT,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  textOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: DRYNKS_WHITE,
  },
  subtitle: {
    fontSize: 13,
    color: '#ddd',
  },
  meta: {
    fontSize: 12,
    color: '#ccc',
    marginTop: 1,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ccc',
    margin: 3,
  },
  activeDot: {
    backgroundColor: DRYNKS_RED,
    width: 8,
    height: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 10,
    paddingBottom: 14,
    gap: 10,
  },
  outlineBtn: {
    borderColor: DRYNKS_RED,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  outlineText: {
    color: DRYNKS_RED,
    fontWeight: '600',
    fontSize: 13,
  },
  primaryBtn: {
    backgroundColor: DRYNKS_RED,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: DRYNKS_WHITE,
    fontWeight: '600',
    fontSize: 13,
  },
  notice: {
    textAlign: 'center',
    padding: 8,
    color: '#999',
    fontStyle: 'italic',
    fontSize: 12,
  },
});

export default DateCard;
