// Production-ready: scrollable gallery + bottom dots + full screenname
// + origin-aware profile nav + "Invited" disabled state.

import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  ImageBackground,
  TouchableOpacity,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Linking,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

const { width: SCREEN_W } = Dimensions.get('window');
const GOLDEN_RATIO = 1.618;

type ProfileUser = {
  id: string;
  screenname?: string | null;
  profile_photo?: string | null;
  gallery_photos?: Array<string | { url?: string } | null> | string | null;
  birthdate?: string | null;
  gender?: string | null;
  orientation?: string | null;
  preferences?: string[] | null;
  location?: string | null;
  distance_km?: number | null;
};

type Props = {
  user: ProfileUser;
  compact?: boolean;
  origin?: string;
  invited?: boolean;
  onInvite?: () => void;

  onPressProfile?: () => void;
  onNamePress?: () => void;
  onAvatarPress?: () => void;
};

const calculateAge = (dob?: string | null): number | null => {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(+birth)) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
};

const toUrl = (x: any): string | null => {
  if (!x) return null;
  if (typeof x === 'string') return x;
  if (x.url) return String(x.url);
  return null;
};

function normalizePhotos(user: ProfileUser): string[] {
  const out: string[] = [];
  const add = (u?: string | null) => { if (u) out.push(u); };
  add(user?.profile_photo || null);

  const g = user?.gallery_photos;
  if (Array.isArray(g)) {
    for (const entry of g) {
      const u = toUrl(entry);
      if (u) out.push(u);
    }
  } else if (typeof g === 'string') {
    try {
      if (/^\s*\[/.test(g)) {
        const arr = JSON.parse(g);
        if (Array.isArray(arr)) {
          for (const entry of arr) {
            const u = toUrl(entry);
            if (u) out.push(u);
          }
        }
      } else if (/^https?:\/\//i.test(g)) {
        out.push(g);
      }
    } catch {
      if (/^https?:\/\//i.test(g)) out.push(g);
    }
  }

  const seen = new Set<string>();
  return out.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
}

const ProfileCard: React.FC<Props> = ({
  user,
  compact = false,
  origin,
  invited = false,
  onInvite,
  onPressProfile,
  onNamePress,
  onAvatarPress, // not used
}) => {
  const navigation = useNavigation<any>();

  const photos = useMemo(() => normalizePhotos(user), [user]);
  const age = calculateAge(user?.birthdate);
  const distanceMiles =
    typeof user?.distance_km === 'number'
      ? Math.round(user.distance_km * 0.621371)
      : null;

  const CARD_WIDTH = compact ? (SCREEN_W - 48) / 2 : SCREEN_W - 32;
  const CARD_HEIGHT = Math.round(CARD_WIDTH * GOLDEN_RATIO);

  const flatRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(0);

  const safeOpenProfile = useCallback(() => {
    if (onPressProfile) { onPressProfile(); return; }
    try { navigation.navigate('PublicProfile', { userId: user.id, origin: origin || 'Unknown' }); return; } catch {}
    try { navigation.navigate('ProfileDetails', { userId: user.id, origin: origin || 'Unknown' }); return; } catch {}
    try { navigation.navigate('UserProfile', { userId: user.id, origin: origin || 'Unknown' }); return; } catch {}
    const url = `dr-ynks://profile/${encodeURIComponent(user.id)}?origin=${encodeURIComponent(origin || 'Unknown')}`;
    Linking.openURL(url).catch(() => {});
  }, [navigation, onPressProfile, user.id, origin]);

  const safeOpenProfileFromName = useCallback(() => {
    if (onNamePress) { onNamePress(); return; }
    safeOpenProfile();
  }, [onNamePress, safeOpenProfile]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / CARD_WIDTH);
    if (i !== index) setIndex(i);
  };

  const renderPhoto = useCallback(
    ({ item }: ListRenderItemInfo<string>) => {
      const uri = item || undefined;
      return (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={safeOpenProfile}
          accessibilityRole="button"
          accessibilityLabel={`Open ${user?.screenname || 'user'} profile`}
        >
          <ImageBackground
            source={uri ? { uri } : undefined}
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              justifyContent: 'flex-end',
              backgroundColor: uri ? undefined : '#e9eef3',
            }}
            imageStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
          >
            {photos.length > 1 && (
              <View style={[styles.dotsRow, { width: CARD_WIDTH }]}>
                {photos.map((_, i) => (
                  <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
                ))}
              </View>
            )}

            <View style={styles.overlay}>
              <View style={styles.nameRow}>
                <TouchableOpacity onPress={safeOpenProfileFromName} activeOpacity={0.7}>
                  <Text style={styles.name} numberOfLines={2}>
                    {user?.screenname || 'Unknown'}
                    {typeof age === 'number' ? <Text style={styles.nameAge}>{`, ${age}`}</Text> : null}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.detail} numberOfLines={1}>
                {(user?.gender || '-')}{user?.orientation ? ` • ${user.orientation}` : ''}
              </Text>

              {!!(user?.preferences && user.preferences.length) && (
                <Text style={styles.detail} numberOfLines={1}>
                  Into: {user.preferences.join(', ')}
                </Text>
              )}

              <Text style={styles.detail} numberOfLines={1}>
                {user?.location || '-'}{distanceMiles ? ` • ${distanceMiles} mi` : ''}
              </Text>
            </View>
          </ImageBackground>
        </TouchableOpacity>
      );
    },
    [safeOpenProfile, safeOpenProfileFromName, CARD_WIDTH, CARD_HEIGHT, photos.length, index, user?.screenname, age, user?.gender, user?.orientation, user?.preferences, user?.location, distanceMiles]
  );

  return (
    <View
      style={[
        styles.card,
        { width: CARD_WIDTH, height: CARD_HEIGHT + 50 },
      ]}
    >
      <FlatList
        ref={flatRef}
        data={photos.length ? photos : ['']}
        renderItem={renderPhoto}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(uri, idx) => String(uri || `blank_${idx}`)}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, i) => ({ length: CARD_WIDTH, offset: CARD_WIDTH * i, index: i })}
        snapToAlignment="start"
        decelerationRate={Platform.OS === 'ios' ? 'fast' : 0.98}
      />

      <TouchableOpacity
        onPress={onInvite}
        style={[styles.inviteButton, invited && styles.inviteButtonDisabled]}
        activeOpacity={invited ? 1 : 0.9}
        disabled={invited}
        accessibilityRole="button"
        accessibilityState={{ disabled: invited }}
        accessibilityLabel={invited ? 'Already invited' : 'Invite user'}
      >
        <Text style={styles.inviteText}>{invited ? 'Invited' : 'Invite'}</Text>
      </TouchableOpacity>
    </View>
  );
};

const DOT_SIZE = 7;

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
    elevation: 4,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 12,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  nameRow: { flexDirection: 'row', alignItems: 'flex-end' },
  name: { fontSize: 22, color: 'white', fontWeight: 'bold', lineHeight: 26 },
  nameAge: { color: 'white', fontSize: 20, fontWeight: '700' },
  detail: { color: '#eee', fontSize: 13, marginTop: 2 },
  dotsRow: {
    position: 'absolute',
    bottom: 58,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.6)',
    marginHorizontal: 3,
  },
  dotActive: { backgroundColor: '#fff' },
  inviteButton: {
    backgroundColor: '#E34E5C',
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  inviteButtonDisabled: { backgroundColor: '#C9CED3' },
  inviteText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});

export default ProfileCard;
