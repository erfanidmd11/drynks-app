// Photo-first profile with swipe gallery, dots, fullscreen viewer, and origin-aware header back + Edit

import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
  ScrollView,
  Modal,
  StatusBar,
  SafeAreaView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import RoundedBackButton from '@components/nav/RoundedBackButton';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HERO_H = Math.min(SCREEN_H * 0.72, 680);

type RouteParams = { userId?: string; origin?: string };

type ProfileRow = {
  id: string;
  screenname?: string | null;
  profile_photo?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  location?: string | null;
  preferences?: string[] | null;
  orientation?: string | null;
  about?: string | null;
  gallery_photos?: string[] | null;
};

function ageFromBirthdate(birthdate?: string | null) {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(+d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export default function ProfileDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute() as any;

  const routeUserId: string | undefined = (route?.params as RouteParams)?.userId;
  const origin: string | undefined = (route?.params as RouteParams)?.origin;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | null>(routeUserId ?? null);

  // viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const heroRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(0);

  // Resolve logged-in user if userId not provided
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id ?? null;
      if (!mounted) return;
      setMe(uid);
      if (!routeUserId && uid) setTargetUserId(uid);
    })();
    return () => {
      mounted = false;
    };
  }, [routeUserId]);

  // Load target profile
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!targetUserId) return;
      setLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetUserId)
        .single();

      if (!mounted) return;

      if (error) {
        setLoadError(error.message || 'Failed to load profile');
        setProfile(null);
      } else {
        setProfile(data as ProfileRow);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [targetUserId]);

  const age = useMemo(() => ageFromBirthdate(profile?.birthdate), [profile?.birthdate]);
  const isOwner = !!(me && profile && me === profile.id);

  // Header: rounded back + Edit (if owner) or Report (if not)
  useLayoutEffect(() => {
    const goBackSmart = () => {
      if (origin) {
        navigation.navigate(origin as never);
      } else if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('Explore');
      }
    };

    navigation.setOptions({
      headerTitle: '',
      headerLeft: () => <RoundedBackButton onPress={goBackSmart} />,
      headerRight: () =>
        profile ? (
          isOwner ? (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate('EditProfile', {
                  userId: profile.id,
                  from: route.name,
                })
              }
              style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ color: DRYNKS_RED, fontWeight: '700' }}>Edit</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => {
                Alert.alert('Report', 'Thanks for letting us know. Our team will review.');
              }}
              style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ color: DRYNKS_RED, fontWeight: '700' }}>Report</Text>
            </TouchableOpacity>
          )
        ) : null,
    });
  }, [navigation, origin, route?.name, profile, isOwner]);

  // Build image list (profile photo + gallery, de-duped)
  const images = useMemo(() => {
    const hero = profile?.profile_photo ? [profile.profile_photo] : [];
    const rest = (profile?.gallery_photos || []).filter(Boolean);
    const seen = new Set<string>();
    return [...hero, ...rest].filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });
  }, [profile?.profile_photo, profile?.gallery_photos]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (i !== index) setIndex(i);
  };

  // --- Actions
  const onMessage = () => {
    if (!profile) return;
    navigation.navigate('PrivateChat', { toUserId: profile.id });
  };
  const onInviteToDate = () => {
    if (!profile) return;
    navigation.navigate('CreateDate', { inviteUserId: profile.id });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={DRYNKS_RED} />
      </View>
    );
  }

  if (loadError || !profile) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: '#000' }]}>
        <StatusBar barStyle="light-content" />
        <Text style={{ color: '#fff', marginBottom: 10, fontWeight: '600' }}>
          {loadError || 'Profile not found.'}
        </Text>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Explore'))}
          style={styles.retryBtn}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const NameLine = (
    <View style={styles.nameRow}>
      <Text style={styles.name} numberOfLines={1}>
        {profile.screenname || 'User'}
      </Text>
      {typeof age === 'number' ? <Text style={styles.nameAge}> {age}</Text> : null}
    </View>
  );

  const MetaLine = (
    <Text style={styles.meta} numberOfLines={1}>
      {profile.gender ? `${profile.gender} • ` : ''}{profile.location || 'Unknown'}
    </Text>
  );

  const Interests =
    Array.isArray(profile.preferences) &&
    profile.preferences.length > 0 && (
      <View style={styles.chipsRow}>
        {profile.preferences.slice(0, 8).map((p, i) => (
          <View key={`${p}-${i}`} style={styles.chip}>
            <Text style={styles.chipText}>{p}</Text>
          </View>
        ))}
      </View>
    );

  const About =
    !!profile.about && (
      <View style={{ marginTop: 10 }}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.about}>{profile.about}</Text>
      </View>
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" />

      {/* HERO — swipeable photos */}
      <View style={styles.heroWrap}>
        <FlatList
          ref={heroRef}
          data={images.length ? images : ['']}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(u, i) => `${i}-${u}`}
          renderItem={({ item, index: i }) => (
            <TouchableOpacity
              activeOpacity={0.95}
              onPress={() => {
                setViewerIndex(i);
                setViewerOpen(true);
              }}
            >
              {item ? (
                <Image source={{ uri: item }} style={styles.heroImage} />
              ) : (
                <View style={[styles.heroImage, { backgroundColor: '#1b1b1b' }]} />
              )}
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.heroGradient} />
              <View style={styles.heroOverlay}>
                {NameLine}
                {MetaLine}
                {!!profile.orientation && (
                  <Text style={[styles.meta, { marginTop: 4 }]}>Orientation: {profile.orientation}</Text>
                )}
                {Interests}
              </View>
            </TouchableOpacity>
          )}
          onMomentumScrollEnd={onMomentumEnd}
        />

        {/* Dots */}
        {images.length > 1 && (
          <View style={styles.dots}>
            {images.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>
        )}
      </View>

      {/* Content panel */}
      <ScrollView
        style={styles.sheet}
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        {About}

        {/* Actions */}
        <View style={styles.actionsRow}>
          {!isOwner ? (
            <>
              <TouchableOpacity onPress={onMessage} style={[styles.cta, styles.ctaPrimary]}>
                <Text style={styles.ctaText}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onInviteToDate} style={[styles.cta, styles.ctaSecondary]}>
                <Text style={styles.ctaTextDark}>Invite to Date</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              onPress={() => navigation.navigate('EditProfile', { userId: profile.id, from: route.name })}
              style={[styles.cta, styles.ctaPrimary]}
            >
              <Text style={styles.ctaText}>Edit Profile</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Fullscreen viewer */}
      <Modal visible={viewerOpen} animationType="fade" transparent>
        <View style={styles.viewerWrap}>
          <StatusBar barStyle="light-content" hidden />
          <View style={styles.viewerTop}>
            <TouchableOpacity
              onPress={() => setViewerOpen(false)}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            >
              <Text style={styles.closeX}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.viewerCount}>
              {Math.min(viewerIndex + 1, images.length)}/{images.length}
            </Text>
            <View style={{ width: 26 }} />
          </View>

          <FlatList
            horizontal
            pagingEnabled
            initialScrollIndex={viewerIndex}
            getItemLayout={(_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
            data={images.length ? images : ['']}
            keyExtractor={(u, i) => `${i}-${u}-viewer`}
            onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
              const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
              setViewerIndex(i);
            }}
            renderItem={({ item }) => (
              <ScrollView
                style={{ width: SCREEN_W }}
                contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', height: SCREEN_H }}
                maximumZoomScale={3}
                minimumZoomScale={1}
                bouncesZoom
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                centerContent
              >
                {item ? (
                  <Image source={{ uri: item }} style={styles.viewerImg} />
                ) : (
                  <View style={[styles.viewerImg, { backgroundColor: '#111' }]} />
                )}
              </ScrollView>
            )}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  retryBtn: { backgroundColor: DRYNKS_RED, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },

  heroWrap: { width: SCREEN_W, height: HERO_H, backgroundColor: '#000' },
  heroImage: { width: SCREEN_W, height: HERO_H, resizeMode: 'cover' },
  heroGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 180 },
  heroOverlay: { position: 'absolute', left: 16, right: 16, bottom: 20 },

  nameRow: { flexDirection: 'row', alignItems: 'flex-end' },
  name: { color: '#fff', fontSize: 32, fontWeight: '800', maxWidth: SCREEN_W - 120 },
  nameAge: { color: '#fff', fontSize: 28, fontWeight: '700' },
  meta: { color: '#fff', opacity: 0.95, marginTop: 4, fontSize: 14 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: '#fff' },

  sheet: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    marginTop: -18,
  },
  sectionTitle: { fontWeight: '800', color: DRYNKS_BLUE, marginBottom: 6, fontSize: 16 },
  about: { color: '#2A2F36', lineHeight: 20 },

  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 18, paddingHorizontal: 16 },
  cta: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPrimary: { backgroundColor: DRYNKS_RED },
  ctaSecondary: { backgroundColor: '#EEF0F2' },
  ctaText: { color: '#fff', fontWeight: '800' },
  ctaTextDark: { color: DRYNKS_BLUE, fontWeight: '800' },

  viewerWrap: { flex: 1, backgroundColor: '#000' },
  viewerTop: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    zIndex: 20,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    justifyContent: 'space-between',
  },
  closeX: { color: '#fff', fontSize: 22, fontWeight: '800' },
  viewerCount: { color: '#fff', fontWeight: '700' },
  viewerImg: { width: SCREEN_W, height: SCREEN_H, resizeMode: 'contain' },
});
