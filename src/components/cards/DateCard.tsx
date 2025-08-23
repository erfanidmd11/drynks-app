// src/components/cards/DateCard.tsx
// Production-ready: resilient date cover resolver (multi-field + auto bucket detection),
// de-dup gallery, and robust profile deep-links.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  FlatList,
  Alert,
  TextInput,
  Linking,
  Platform,
  Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import StatusBadge from '@components/common/StatusBadge';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const H_PADDING = 12;
const CARD_WIDTH = SCREEN_WIDTH - H_PADDING * 2;
const IMAGE_HEIGHT = Math.round(CARD_WIDTH / 1.618);

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

// Default bucket if only a path is provided (no bucket prefix)
const DEFAULT_DATE_BUCKET = 'date-photos';

// ----------------------------------------------------
// small helpers
// ----------------------------------------------------
const friendlyPayLabel = (raw?: string | null, screenname?: string) => {
  if (!raw) return '💸 Unknown';
  const lower = String(raw).toLowerCase();
  if (lower.includes('sponsor')) return '🤑 Looking for Sponsor';
  if (lower.includes('i am paying')) return `🧾 ${screenname || 'Host'} Pays`;
  if (lower.includes('50')) return '🤝 Going Dutch';
  return `💰 ${raw}`;
};

const toUrl = (p: any): string | null => {
  if (!p) return null;
  if (typeof p === 'string') return p;
  if (p.url) return String(p.url);
  if (p.photo) return String(p.photo);
  return null;
};

function normalizeArray(arrOrStr?: any): string[] {
  if (!arrOrStr) return [];
  try {
    if (typeof arrOrStr === 'string') {
      if (/^\s*\[/.test(arrOrStr)) {
        const parsed = JSON.parse(arrOrStr);
        return Array.isArray(parsed) ? (parsed.map(toUrl).filter(Boolean) as string[]) : [];
      }
      if (/^https?:\/\//i.test(arrOrStr)) return [arrOrStr];
      // support "bucket/path.jpg" single path as well
      if (/^[^/]+\/[^/].+/.test(arrOrStr)) return [arrOrStr];
      return [];
    }
    if (Array.isArray(arrOrStr)) return arrOrStr.map(toUrl).filter(Boolean) as string[];
    return [];
  } catch {
    if (typeof arrOrStr === 'string' && /^https?:\/\//i.test(arrOrStr)) return [arrOrStr];
    return [];
  }
}

const looksLikeWKTOrHex = (s?: string | null) =>
  !!s && (/^SRID=/i.test(s) || /^[0-9A-F]{16,}$/i.test(String(s)));

const ageFromBirthdate = (birthdate?: string | null) => {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(+d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

const getProfileId = (p: any) => p?.id || p?.profile_id || p?.user_id || p?.userId || p?.uid || null;
const getCreatorIdFromDate = (date: any) =>
  date?.creator_id || date?.host_id || date?.creator || getProfileId(date?.creator_profile) || null;

// ----------------------------------------------------
// Supabase URL resolution (auto bucket detection)
// Accepts:
//  - HTTPS URL → returns as-is
//  - "bucket/path/to/file.jpg" → signs with specified bucket
//  - "path/only.jpg" → signs using DEFAULT_DATE_BUCKET
// ----------------------------------------------------
async function resolveSupabaseUrlAuto(pathOrUrl?: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  const s = String(pathOrUrl);

  if (/^https?:\/\//i.test(s)) return s;

  // If looks like "bucket/path"
  if (/^[^/]+\/[^/].+/.test(s)) {
    const firstSlash = s.indexOf('/');
       const bucket = s.slice(0, firstSlash);
    const objectPath = s.slice(firstSlash + 1);
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 3600);
      if (!error && data?.signedUrl) return data.signedUrl;
      const pub = supabase.storage.from(bucket).getPublicUrl(objectPath);
      return pub?.data?.publicUrl ?? null;
    } catch {
      return null;
    }
  }

  // Else treat it as object path in default bucket
  try {
    const { data, error } = await supabase.storage.from(DEFAULT_DATE_BUCKET).createSignedUrl(s, 3600);
    if (!error && data?.signedUrl) return data.signedUrl;
    const pub = supabase.storage.from(DEFAULT_DATE_BUCKET).getPublicUrl(s);
    return pub?.data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

// Gather ALL reasonable date photo candidates, in priority order
function collectDatePhotoCandidates(date: any): string[] {
  // Most common single fields first
  const ordered = [date?.cover_image_url, date?.cover_photo, date?.banner_url, date?.event_photo];

  // Paths that may need signing
  const pathish = [date?.cover_image_path, date?.banner_path];

  // Arrays / legacy / JSON
  const arrays = [
    date?.photo_urls,
    date?.photo_url,
    date?.photo_paths,
    date?.images,
    date?.media,
    date?.photos,
    date?.gallery, // in case some schemas used this
  ];

  // Flatten everything to strings
  const out: string[] = [];
  for (const x of ordered) {
    const u = toUrl(x);
    if (u) out.push(u);
  }
  for (const p of pathish) {
    const u = toUrl(p) || (typeof p === 'string' ? p : null);
    if (u) out.push(u);
  }
  for (const arr of arrays) {
    out.push(...normalizeArray(arr));
  }

  // de-dupe
  const seen = new Set<string>();
  return out.filter((u) => (u ? (!seen.has(u) && (seen.add(u), true)) : false));
}

// ----------------------------------------------------
// Component
// ----------------------------------------------------
type DateCardProps = {
  date: any;
  userId: string;
  isCreator?: boolean;
  isAccepted?: boolean;
  disabled?: boolean;
  onAccept?: () => void;
  onChat?: () => void;
  onPressProfile?: (profileId: string) => void; // optional; falls back to internal navigate
  onPressCard?: () => void;
  onNotInterested?: () => void;
};

const DateCard: React.FC<DateCardProps> = ({
  date,
  userId,
  isCreator,
  isAccepted,
  disabled,
  onAccept,
  onChat,
  onPressProfile,
  onPressCard,
  onNotInterested,
}) => {
  const navigation = useNavigation<any>();
  const [requested, setRequested] = useState(false);
  const [showInviteOptions, setShowInviteOptions] = useState(false);
  const [username, setUsername] = useState('');
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [dropdownClosedByTap, setDropdownClosedByTap] = useState(false);
  const [userSuggestions, setUserSuggestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList<any>>(null);

  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(`requested_${date.id}`).then((v) => v === 'true' && setRequested(true));
  }, [date?.id]);

  // Robust cover resolver (now checks many fields + auto bucket detection)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const candidates = collectDatePhotoCandidates(date);

      // Try to resolve candidates in order
      for (const cand of candidates) {
        const resolved = await resolveSupabaseUrlAuto(cand);
        if (resolved) {
          if (!cancelled) setCoverUrl(resolved);
          return;
        }
      }

      // Absolute last resort: creator/gallery first photo
      const fallback =
        toUrl(date?.creator_profile?.profile_photo) ||
        (normalizeArray(date?.creator_profile?.gallery_photos)[0] ?? null);

      if (!cancelled) setCoverUrl(fallback ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    date?.cover_image_url,
    date?.cover_photo,
    date?.banner_url,
    date?.event_photo,
    date?.cover_image_path,
    date?.banner_path,
    date?.photo_paths,
    date?.photo_urls,
    date?.photo_url,
    date?.images,
    date?.media,
    date?.photos,
    date?.gallery,
    date?.creator_profile,
  ]);

  // Username suggestions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (username.trim().length < 2) {
        setUserSuggestions([]);
        return;
      }
      setLoadingSuggestions(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, screenname, profile_photo')
        .ilike('screenname', `%${username}%`)
        .neq('id', userId)
        .limit(5);

      if (!cancelled) {
        if (!error && data) setUserSuggestions(data);
        setLoadingSuggestions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, userId]);

  // notify host
  const notifyHost = async (msg: string) => {
    try {
      const creator_id = getCreatorIdFromDate(date);
      if (!creator_id || creator_id === userId) return;
      await supabase.from('notifications').insert([
        { user_id: creator_id, message: msg, screen: 'MyDates', params: { date_id: date.id } },
      ]);
    } catch {
      /* ignore */
    }
  };

  const handleRequest = async () => {
    await AsyncStorage.setItem(`requested_${date.id}`, 'true');
    setRequested(true);
    Alert.alert('🎉 Date Requested', 'Check My Dates to follow up.');
    onAccept && onAccept();
    await notifyHost('💌 You have a join request on your date.');
  };

  const handleJoinChat = () => {
    onChat && onChat();
  };

  const handleInAppInvite = async (user: any) => {
    try {
      await supabase.from('notifications').insert([
        {
          user_id: user.id,
          message: `${date.creator_profile?.screenname || 'Someone'} invited you to "${date.title}"`,
          screen: 'MyDates',
          params: { date_id: date.id, action: 'invite_inapp' },
        },
      ]);
      Alert.alert('✅ Invite sent to ' + user.screenname);
      setUsername('');
      setUserSuggestions([]);
      setDropdownClosedByTap(true);
    } catch (err: any) {
      Alert.alert('Error sending invite', err.message || String(err));
    }
  };

  const handleTextInvite = async (phoneNumber?: string) => {
    try {
      const message =
        `You've been invited to join DrYnks! 🎉\n` +
        `Download the app and see your invite now: https://dr-ynks.app.link/invite/${date.id}`;
      await Linking.openURL(`sms:${phoneNumber ?? ''}?body=${encodeURIComponent(message)}`);
      await supabase.from('notifications').insert([
        {
          user_id: userId,
          message: `Shared a text invite to "${date.title}"`,
          screen: 'MyDates',
          params: { date_id: date.id, action: 'invite_text' },
        },
      ]);
    } catch (err: any) {
      Alert.alert('Error sending invite', err.message || String(err));
    }
  };

  // ---- navigation to profile (robust, points to your actual route) ----
  const safeNavigateToProfile = (pid: string, e?: any) => {
    // stop parent card presses from firing when tapping the inline link
    e?.stopPropagation?.();
    if (onPressProfile) {
      onPressProfile(pid);
      return;
    }
    // Primary: your AppNavigator registers ProfileDetailsScreen as "Profile"
    try {
      navigation.navigate('Profile', { userId: pid, origin: 'DateFeed' });
      return;
    } catch {}
    // Legacy fallbacks (kept just in case)
    try {
      navigation.navigate('PublicProfile', { userId: pid, origin: 'DateFeed' });
      return;
    } catch {}
    try {
      navigation.navigate('ProfileDetails', { userId: pid, origin: 'DateFeed' });
      return;
    } catch {}
    try {
      navigation.navigate('UserProfile', { userId: pid, origin: 'DateFeed' });
      return;
    } catch {}
    const url = `dr-ynks://profile/${encodeURIComponent(pid)}?origin=DateFeed`;
    Linking.openURL(url).catch(() => {});
  };
  const goToProfile = (pid?: string | null, e?: any) => {
    if (pid) safeNavigateToProfile(String(pid), e);
  };

  // ---- data shapers ----
  const creator = date.creator_profile || {};
  const accepted: any[] = Array.isArray(date.accepted_profiles) ? date.accepted_profiles : [];
  const eventIsPast = date?.event_date ? new Date(date.event_date) < new Date() : false;

  // Build gallery: event cover → host → accepted (with de-dupe)
  const gallery = useMemo(() => {
    const slides: { type: 'event' | 'creator' | 'accepted'; url?: string; profile?: any }[] = [];
    const addedUrls = new Set<string>();

    const pushEvent = (url?: string | null) => {
      if (url && !addedUrls.has(url)) {
        slides.push({ type: 'event', url });
        addedUrls.add(url);
      }
    };
    const pushProfile = (type: 'creator' | 'accepted', p: any) => {
      const u = p?.profile_photo || null;
      if (u && !addedUrls.has(u)) {
        slides.push({ type, profile: p });
        addedUrls.add(u);
      }
    };

    pushEvent(coverUrl);
    if (creator?.profile_photo) pushProfile('creator', creator);
    for (const p of accepted) if (p?.profile_photo) pushProfile('accepted', p);
    if (slides.length === 0 && creator?.profile_photo) pushProfile('creator', creator);
    return slides;
  }, [coverUrl, creator, accepted]);

  const displayLocation = !looksLikeWKTOrHex(date?.location)
    ? String(date?.location ?? '')
    : date?.creator_profile?.location ?? '';

  const totals = (date?.preferred_gender_counts || {}) as Record<string, number>;
  const remaining = (date?.remaining_gender_counts || {}) as Record<string, number>;
  const totalCapacity =
    typeof date?.spots === 'number'
      ? date.spots
      : (totals.Male ?? 0) + (totals.Female ?? 0) + (totals.TS ?? 0) || undefined;

  const makeLine = (label: 'Male' | 'Female') => {
    const total = totals?.[label] ?? 0;
    const rem = remaining?.[label];
    if (typeof rem === 'number') return `${label} ${rem}/${total}`;
    const acc = (accepted || []).reduce((cnt, p) => (p?.gender === label ? cnt + 1 : cnt), 0);
    const inferredRem = Math.max(total - acc, 0);
    return total ? `${label} ${inferredRem}/${total}` : null;
  };
  const maleStr = makeLine('Male');
  const femaleStr = makeLine('Female');
  const spotsLeft = (remaining?.Male ?? 0) + (remaining?.Female ?? 0) + (remaining?.TS ?? 0);

  // ---- render helpers ----
  const renderMainOverlay = () => {
    const hostPid = getCreatorIdFromDate(date);
    return (
      <View style={styles.textOverlay}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={2}>
            {String(date.title || '')}
          </Text>
          <View style={styles.spotsPill}>
            <Text style={styles.spotsText}>{typeof spotsLeft === 'number' ? `${spotsLeft} left` : ''}</Text>
          </View>
        </View>

        <StatusBadge status={eventIsPast ? 'closed' : 'open'} />

        <Text style={styles.meta}>
          {date?.event_date ? new Date(date.event_date).toDateString() : ''}
          {typeof date.distance_miles === 'number' ? ` • ${Number(date.distance_miles).toFixed(1)} mi` : ''}
        </Text>

        {!!displayLocation && <Text style={styles.meta}>{displayLocation}</Text>}

        <TouchableOpacity onPress={(e) => goToProfile(String(hostPid), e)} activeOpacity={0.8}>
          <Text style={styles.meta}>
            Host: <Text style={styles.link}>{creator?.screenname || 'Unknown'}</Text>
          </Text>
        </TouchableOpacity>

        <Text style={styles.meta}>{friendlyPayLabel(date.who_pays, creator?.screenname)}</Text>

        <Text style={styles.meta}>
          Orientation:{' '}
          {Array.isArray(date.orientation_preference)
            ? date.orientation_preference.join(', ')
            : date.orientation_preference || 'Everyone'}
        </Text>
        <Text style={styles.meta}>Event Type: {date.event_type}</Text>

        {(typeof totalCapacity === 'number' || maleStr || femaleStr) && (
          <View style={{ marginTop: 2 }}>
            <Text style={[styles.meta, { fontWeight: '700' }]}>Capacity</Text>
            <Text style={styles.meta}>
              {typeof totalCapacity === 'number' ? `${totalCapacity} total` : '—'}
              {maleStr ? ` • ${maleStr}` : ''}
              {femaleStr ? ` • ${femaleStr}` : ''}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderProfileOverlay = (p: any, labelPrefix = '') => {
    const age = ageFromBirthdate(p?.birthdate);
    const city = p?.location;
    const pid = getProfileId(p);
    return (
      <View style={styles.textOverlay}>
        <TouchableOpacity onPress={(e) => goToProfile(String(pid), e)} activeOpacity={0.8}>
          <Text style={styles.title}>
            {labelPrefix ? `${labelPrefix}: ` : ''}
            <Text style={styles.link}>{p?.screenname || 'User'}</Text>
          </Text>
        </TouchableOpacity>
        <Text style={styles.meta}>
          {age ? `${age} • ` : ''}
          {city ? city : ''}
        </Text>
        {p?.gender ? <Text style={styles.meta}>Gender: {p.gender}</Text> : null}
        {Array.isArray(p?.preferences) && p.preferences.length > 0 ? (
          <Text style={styles.meta}>Interested in: {p.preferences.join(', ')}</Text>
        ) : null}
      </View>
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    const p = item.profile;
    const pid = getProfileId(p);
    const imgUri = item.url ?? p?.profile_photo;

    const handleSlidePress =
      item.type === 'event'
        ? () => {
            onPressCard && onPressCard();
          }
        : () => goToProfile(String(pid));

    return (
      <TouchableOpacity activeOpacity={0.92} onPress={handleSlidePress}>
        <View style={styles.slide}>
          {imgUri ? (
            <Image source={{ uri: imgUri }} style={styles.image} />
          ) : (
            <View
              style={[styles.image, { backgroundColor: '#0f141a', alignItems: 'center', justifyContent: 'center' }]}
            >
              <Text style={{ color: '#fff', opacity: 0.7 }}>No photo yet</Text>
            </View>
          )}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.78)']} style={styles.overlay} pointerEvents="none" />
          {item.type === 'event' && renderMainOverlay()}
          {item.type === 'creator' && renderProfileOverlay(p, 'Host')}
          {item.type === 'accepted' && renderProfileOverlay(p, 'Guest')}
        </View>
      </TouchableOpacity>
    );
  };

  const showDots = gallery.length > 1;

  return (
    <View style={styles.card}>
      <View style={{ position: 'relative' }}>
        <View style={styles.counterPill} pointerEvents="none">
          <Text style={styles.counterText}>{gallery.length} 📸</Text>
        </View>

        <FlatList
          ref={flatListRef}
          horizontal
          pagingEnabled
          data={gallery}
          keyExtractor={(_, i) => `g-${i}`}
          renderItem={renderItem}
          snapToAlignment="start"
          decelerationRate={Platform.OS === 'ios' ? 'fast' : 0.98}
          showsHorizontalScrollIndicator={false}
          snapToInterval={CARD_WIDTH}
          getItemLayout={(_, index) => ({ length: CARD_WIDTH, offset: CARD_WIDTH * index, index })}
          onScroll={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / CARD_WIDTH);
            if (idx !== currentIndex) setCurrentIndex(idx);
          }}
          scrollEventThrottle={16}
        />
      </View>

      {showDots && (
        <View style={styles.dotsRow}>
          {gallery.map((_, i) => (
            <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive, i !== 0 && { marginLeft: 6 }]} />
          ))}
        </View>
      )}

      {!eventIsPast && !disabled && !isCreator && (
        <View style={styles.buttonRow}>
          <TouchableOpacity onPress={() => onNotInterested?.()} style={[styles.btn, styles.btnRed, { marginRight: 10 }]}>
            <Text style={styles.btnText}>Not Interested</Text>
          </TouchableOpacity>

          {!requested ? (
            <TouchableOpacity onPress={handleRequest} style={[styles.btn, styles.btnBlue]}>
              <Text style={styles.btnText}>Request to Join</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.btn, styles.btnDisabled]}>
              <Text style={styles.btnText}>Requested</Text>
            </View>
          )}
        </View>
      )}

      {isAccepted && !eventIsPast && (
        <TouchableOpacity
          onPress={handleJoinChat}
          style={[styles.btn, styles.btnBlue, { alignSelf: 'center', marginTop: 6 }]}
        >
          <Text style={styles.btnText}>Join Chat</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => setShowInviteOptions(!showInviteOptions)} style={styles.inviteBtn}>
        <Text style={styles.inviteText}>Invite Friends</Text>
      </TouchableOpacity>

      {showInviteOptions && (
        <View style={styles.inviteSection}>
          <Text style={styles.inviteOption}>🔍 Invite In-App</Text>
          <TextInput
            style={styles.inputBox}
            placeholder="Enter username"
            value={username}
            onChangeText={setUsername}
            onFocus={() => setDropdownClosedByTap(false)}
            onBlur={() => setDropdownClosedByTap(true)}
          />
          {loadingSuggestions ? (
            <Text style={styles.meta}>Loading...</Text>
          ) : userSuggestions.length === 0 && username.length > 1 && !dropdownClosedByTap ? (
            <Text style={styles.meta}>No matches found</Text>
          ) : (
            userSuggestions.map((u) => (
              <TouchableOpacity key={u.id} onPress={() => handleInAppInvite(u)} style={styles.suggestionRow}>
                {!!u.profile_photo && <Image source={{ uri: u.profile_photo }} style={styles.avatar} />}
                <Text style={styles.meta}>{u.screenname}</Text>
              </TouchableOpacity>
            ))
          )}

          <Text style={styles.inviteOption}>🌐 Share on Social</Text>
          <TouchableOpacity
            onPress={async () => {
              try {
                const message =
                  `🎉 Join me on DrYnks for "${date.title}"!\n\n` +
                  `Download the app and you'll see the invite after registering:\n` +
                  `https://dr-ynks.app.link/invite/${date.id}`;
                await Share.share({ message });
                await supabase.from('notifications').insert([
                  {
                    user_id: userId,
                    message: `Shared invite to "${date.title}"`,
                    screen: 'MyDates',
                    params: { date_id: date.id, action: 'share_social' },
                  },
                ]);
              } catch (err: any) {
                Alert.alert('Error sharing invite', err.message || String(err));
              }
            }}
            style={styles.inviteBtn}
          >
            <Text style={styles.inviteText}>Share Date</Text>
          </TouchableOpacity>

          <Text style={styles.inviteOption}>💬 Invite via Text</Text>
          <TouchableOpacity onPress={() => handleTextInvite()} style={styles.inviteBtn}>
            <Text style={styles.inviteText}>Send Text Invite</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: H_PADDING,
    marginVertical: 10,
    backgroundColor: DRYNKS_WHITE,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  slide: {
    width: CARD_WIDTH,
    height: IMAGE_HEIGHT,
    overflow: 'hidden',
    borderRadius: 20,
  },
  image: {
    width: CARD_WIDTH,
    height: IMAGE_HEIGHT,
    resizeMode: 'cover',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  textOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spotsPill: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  spotsText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  title: {
    fontSize: 22,
    fontWeight: '800',
    color: DRYNKS_WHITE,
    flexShrink: 1,
    paddingRight: 10,
  },
  link: {
    color: '#e6f0ff',
    textDecorationLine: 'underline',
    fontWeight: '700',
  },
  meta: {
    fontSize: 14,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    paddingTop: 3,
  },
  counterPill: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 5,
    backgroundColor: DRYNKS_RED,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  counterText: { color: 'white', fontWeight: '600' },

  dotsRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#d3d7db',
  },
  dotActive: { backgroundColor: DRYNKS_BLUE },

  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnRed: { backgroundColor: DRYNKS_RED },
  btnBlue: { backgroundColor: DRYNKS_BLUE },
  btnDisabled: { backgroundColor: '#A9B0B7' },
  btnText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
  },

  inviteBtn: {
    borderWidth: 1,
    borderColor: DRYNKS_BLUE,
    paddingVertical: 11,
    borderRadius: 12,
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  inviteText: {
    color: DRYNKS_BLUE,
    fontWeight: '700',
    fontSize: 15,
  },

  inviteSection: {
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  inviteOption: {
    marginTop: 6,
    marginBottom: 6,
    fontWeight: 'bold',
    color: DRYNKS_BLUE,
  },
  inputBox: {
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
  },
});

export default DateCard;
