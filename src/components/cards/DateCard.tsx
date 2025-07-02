// Fully Patched DateCard.tsx (Simplified — No Event Image)
import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableWithoutFeedback,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  Linking,
  Dimensions,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';

const { width } = Dimensions.get('window');

const safeImage = (url: string) =>
  url?.startsWith('http') ? { uri: url } : { uri: 'https://via.placeholder.com/100' };

const DateCard = ({
  date,
  userId,
  isCreator,
  isAccepted,
  isPending,
  showChat,
  onTap = () => {},
  onAccept = () => {},
  onDecline = () => {},
  onInvite = () => {},
  onChat = () => {},
}: any) => {
  const navigation = useNavigation();
  const creator = date?.creator || {};
  const acceptedUsers = Array.isArray(date?.accepted_users) ? date.accepted_users : [];
  const blurred = !isAccepted && !isCreator;
  const capacity = date?.capacity || 1;
  const remaining = capacity - acceptedUsers.length;
  const isFull = remaining <= 0;
  const eventDate = new Date(date?.event_date ?? '');
  const isPast = isNaN(eventDate.getTime()) ? false : eventDate < new Date();

  const [profileVisible, setProfileVisible] = useState(false);
  const [activeUser, setActiveUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const allUsers = [
    { ...creator, type: 'host', avatar_url: creator.avatar_url },
    ...acceptedUsers.map((u) => ({ ...u, type: 'guest' })),
  ];

  const scale = useSharedValue(1);
  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97);
  };
  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  return (
    <GestureHandlerRootView>
      <Animated.View entering={FadeInDown.duration(400)} style={[styles.card, animatedCardStyle]}>
        <TouchableWithoutFeedback onPress={onTap} onPressIn={handlePressIn} onPressOut={handlePressOut}>
          <View>
            <Text style={styles.title}>{date?.title || 'Untitled Event'}</Text>
            <Text style={styles.eventDate}>{eventDate.toDateString()}</Text>
            <Text style={styles.meta}>Spots left: {remaining} / {capacity}</Text>

            <FlatList
              horizontal
              data={allUsers}
              keyExtractor={(u, i) => `${u?.id ?? 'user'}-${i}`}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    if (!blurred) {
                      setActiveUser(item);
                      setProfileVisible(true);
                    }
                  }}
                >
                  <Image source={safeImage(item.avatar_url)} style={styles.avatarCircle} />
                  {!blurred && (
                    <Text style={{ fontSize: 10, textAlign: 'center' }}>{item.type === 'host' ? 'Host' : ''}</Text>
                  )}
                </Pressable>
              )}
            />

            {!isPast && !isFull && (
              <View style={styles.actionsRow}>
                {isPending && (
                  <>
                    <Text style={styles.actionDecline} onPress={onDecline}>Decline</Text>
                    <Text style={styles.actionAccept} onPress={onAccept}>Accept</Text>
                  </>
                )}
                {isAccepted && showChat && (
                  <Text style={styles.actionLink} onPress={onChat}>Join Chat</Text>
                )}
                {(isAccepted || isCreator) && (
                  <Text style={styles.actionLink} onPress={onInvite}>Invite</Text>
                )}
              </View>
            )}

            {isPast && <Text style={styles.pastTag}>This date has passed</Text>}
            {isFull && !isAccepted && !isCreator && <Text style={styles.pastTag}>This date is full</Text>}
          </View>
        </TouchableWithoutFeedback>
      </Animated.View>

      <Modal visible={profileVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.profileModal}>
            {loading ? (
              <ActivityIndicator size="large" color="#ff5a5f" />
            ) : (
              <ScrollView contentContainerStyle={{ alignItems: 'center', padding: 20 }}>
                <Image
                  source={safeImage(activeUser?.avatar_url)}
                  style={{ width: 100, height: 100, borderRadius: 50, marginBottom: 12 }}
                />
                <Text style={styles.name}>{activeUser?.screen_name || 'User'}</Text>
                <Text style={styles.metaText}>
                  {activeUser?.gender || 'Unknown'} • Interested in: {(activeUser?.preferences || []).join(', ')}
                </Text>
                <Text style={styles.metaText}>{activeUser?.age} • {activeUser?.location || 'Unknown'}</Text>
                {activeUser?.about && <Text style={styles.aboutText}>{activeUser.about}</Text>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                  {(activeUser?.gallery_photos || []).map((uri: string, i: number) => (
                    <Image key={i} source={{ uri }} style={styles.galleryPhoto} />
                  ))}
                </View>
                <View style={styles.actionRow}>
                  <Text style={styles.actionButton}>Message</Text>
                  <Text style={styles.actionButton}>Invite</Text>
                </View>
                <Text
                  style={styles.fullProfile}
                  onPress={() => {
                    setProfileVisible(false);
                    setTimeout(() => {
                      if (activeUser?.id) {
                        Linking.openURL(`/profile/${activeUser.id}`);
                      }
                    }, 300);
                  }}
                >View Full Profile</Text>
                <Text style={styles.closeButton} onPress={() => setProfileVisible(false)}>Close</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  avatarCircle: { width: 32, height: 32, borderRadius: 16, marginRight: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileModal: {
    width: width * 0.85,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: 'center',
    maxHeight: '80%',
  },
  name: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  metaText: { fontSize: 14, color: '#555', marginVertical: 2 },
  aboutText: { fontSize: 14, fontStyle: 'italic', color: '#666', marginVertical: 10, textAlign: 'center' },
  galleryPhoto: { width: 60, height: 60, borderRadius: 8, margin: 4 },
  fullProfile: { marginTop: 16, color: '#007BFF', fontWeight: '600' },
  closeButton: { marginTop: 10, color: '#888' },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 20,
  },
  actionButton: {
    backgroundColor: '#ff5a5f',
    color: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
    fontWeight: '600',
  },
  card: {
    marginVertical: 12,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  eventDate: { fontSize: 14, color: '#666', marginBottom: 4 },
  meta: { fontSize: 12, color: '#999', marginBottom: 12 },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  actionLink: { color: '#007AFF', fontWeight: '600' },
  actionAccept: { color: 'green', fontWeight: '600' },
  actionDecline: { color: 'red', fontWeight: '600' },
  pastTag: { color: '#888', fontStyle: 'italic', marginTop: 10 },
});

export default DateCard;
