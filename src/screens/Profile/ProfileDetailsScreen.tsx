// src/screens/Profile/ProfileDetailsScreen.tsx
import React, { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
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
  Pressable,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ---- Theme
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

// ---- Layout
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

// ---- Utils
function ageFromBirthdate(birthdate?: string | null) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(+b)) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

// ---- Soft "glass" (no expo-blur required)
const SoftGlass: React.FC<
  React.PropsWithChildren<{ tint?: 'dark' | 'light'; style?: any }>
> = ({ tint = 'dark', style, children }) => {
  const bg =
    tint === 'dark' ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.65)';
  const border =
    tint === 'dark'
      ? 'rgba(255,255,255,0.18)'
      : 'rgba(0,0,0,0.08)';

  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: border,
        },
        style,
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={
          tint === 'dark'
            ? ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.00)']
            : ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.00)']
        }
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
};

// ---- Glass Back Button
const GlassBackButton: React.FC<{
  onPress: () => void;
  tint?: 'light' | 'dark';
  label?: string;
  color?: string;
}> = ({ onPress, tint = 'dark', label = 'Back', color = '#ffffff' }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      {
        borderRadius: 999,
        overflow: 'hidden',
        transform: [{ scale: pressed ? 0.97 : 1 }],
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      },
    ]}
    android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
    accessibilityRole="button"
    accessibilityLabel="Go back"
  >
    <SoftGlass
      tint={tint}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
      }}
    >
      <Ionicons name="chevron-back" size={18} color={color} />
      <Text style={{ color, fontWeight: '700', letterSpacing: 0.2 }}>
        {label}
      </Text>
    </SoftGlass>
  </Pressable>
);

export default function ProfileDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute() as any;
  const insets = useSafeAreaInsets();

  const { userId: routeUserId, origin } = (route.params || {}) as RouteParams;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | null>(
    routeUserId ?? null
  );

  // Header sizing (push hero down so header isn't floating)
  const TOP_ROW = 44;
  const BACK_ROW = 48;
  const HEADER_SPACING = 10;
  const HEADER_H = insets.top + TOP_ROW + BACK_ROW + HEADER_SPACING;

  // Viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const heroRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(0);

  // ---- Smart back: prefer pop; then origin; then safe app route
  const smartBack = useCallback(() => {
    // 1) If this screen was pushed, pop to the exact previous screen.
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    // 2) Try the declared origin (deep links / reset cases).
    const tryNavigate = (name?: string) => {
      if (!name) return false;
      try { navigation.navigate(name as never); return true; } catch {}
      try { navigation.getParent()?.navigate(name as never); return true; } catch {}
      try { navigation.getParent()?.getParent()?.navigate(name as never); return true; } catch {}
      return false;
    };
    if (origin && tryNavigate(origin)) return;

    // 3) Final safe fallbacks — land inside your main app shell (with header/footer).
    const candidates = [
      'My DrYnks', 'MyDates', 'ManageApplicants', 'MySentInvites',
      'JoinRequests', 'ReceivedInvites', 'Explore', 'DateFeed',
    ];
    for (const name of candidates) {
      if (tryNavigate(name)) return;
      try { navigation.navigate('App' as never, { screen: name } as never); return; } catch {}
    }

    // Last resort — app container
    try { navigation.navigate('App' as never); } catch {}
  }, [navigation, origin]);

  // Resolve session and "me" + default target
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id ?? null;
      if (!mounted) return;
      setMe(uid);
      if (!routeUserId && uid) setTargetUserId(uid);
      // load my avatar for header
      if (uid) {
        const { data: myp } = await supabase
          .from('profiles')
          .select('profile_photo')
          .eq('id', uid)
          .single();
        if (!mounted) return;
        setMyAvatar(myp?.profile_photo ?? null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [routeUserId]);

  const initialFetch = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', targetUserId)
      .single();
    if (error || !data) {
      setLoadError(error?.message || 'Failed to load profile');
      setProfile(null);
    } else {
      setProfile(data as ProfileRow);
    }
    setLoading(false);
  }, [targetUserId]);

  // First load
  useEffect(() => {
    initialFetch();
  }, [initialFetch]);

  // ---- REFRESH ON FOCUS
  const refreshOnFocus = useCallback(async () => {
    if (!targetUserId) return;
    const [{ data: prof }, { data: sess }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', targetUserId).single(),
      supabase.auth.getSession(),
    ]);

    if (prof) setProfile(prof as ProfileRow);

    const uid = sess?.session?.user?.id ?? null;
    setMe(uid);
    if (uid) {
      const { data: myp } = await supabase
        .from('profiles')
        .select('profile_photo')
        .eq('id', uid)
        .single();
      setMyAvatar(myp?.profile_photo ?? null);
    }
  }, [targetUserId]);

  useFocusEffect(
    useCallback(() => {
      refreshOnFocus();
      return () => {};
    }, [refreshOnFocus])
  );

  // ---- LIVE UPDATES VIA SUPABASE REALTIME
  useEffect(() => {
    if (!targetUserId) return;
    const channel = supabase
      .channel(`profiles:detail:${targetUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${targetUserId}` },
        (payload) => {
          if (payload.new) setProfile(payload.new as ProfileRow);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [targetUserId]);

  const age = useMemo(() => ageFromBirthdate(profile?.birthdate), [profile?.birthdate]);
  const isOwner = Boolean(me && profile && me === profile.id);

  // Image list
  const images = useMemo(() => {
    if (!profile) return [];
    const hero = profile.profile_photo ? [profile.profile_photo] : [];
    const rest = (profile.gallery_photos || []).filter(Boolean);
    const seen = new Set<string>();
    return [...hero, ...rest].filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });
  }, [profile]);

  // Hide native header; render our own
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={DRYNKS_RED} />
      </View>
    );
  }

  if (loadError || !profile) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: DRYNKS_BLUE }]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.errorText}>{loadError || 'Profile not found.'}</Text>
        <TouchableOpacity
          onPress={smartBack}
          style={styles.retryBtn}
        >
          <Text style={styles.retryText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (i !== index) setIndex(i);
  };

  const onMessage = () => navigation.navigate('PrivateChat', { toUserId: profile.id });
  const onInviteToDate = () => navigation.navigate('CreateDate', { inviteUserId: profile.id });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DRYNKS_BLUE, paddingTop: HEADER_H }}>
      <StatusBar barStyle="light-content" />

      {/* Header — center logo replaced with DrYnks_Y_logo.png */}
      <View style={styles.headerWrap} pointerEvents="box-none">
        <SoftGlass tint="dark" style={[styles.headerGlass, { paddingTop: insets.top }]}>
          <View style={styles.headerTop}>
            <TouchableOpacity
              onPress={() => navigation.navigate('ProfileMenu')}
              accessibilityLabel="Open Profile Menu"
            >
              {myAvatar ? (
                <Image source={{ uri: myAvatar }} style={styles.headerProfilePic} />
              ) : (
                <View style={styles.headerProfilePlaceholder} />
              )}
            </TouchableOpacity>

            <Image
              source={require('@assets/images/DrYnks_Y_logo.png')}
              style={styles.headerLogoImg}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />

            <TouchableOpacity
              onPress={() => navigation.navigate('Notifications')}
              accessibilityLabel="Open Notifications"
            >
              <Ionicons name="notifications-outline" size={22} color={DRYNKS_WHITE} />
            </TouchableOpacity>
          </View>
          <View style={styles.headerBottom}>
            <GlassBackButton
              onPress={smartBack}
              tint="dark"
              label="Back"
              color="#fff"
            />
            <View style={{ width: 48 }} />
          </View>
        </SoftGlass>
      </View>

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
              activeOpacity={0.9}
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
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.75)']}
                style={styles.heroGradient}
              />
              <View style={styles.heroTextOverlay}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {profile.screenname || 'User'}
                  </Text>
                  {typeof age === 'number' ? <Text style={styles.nameAge}> {age}</Text> : null}
                </View>
                <Text style={styles.meta}>
                  {profile.gender ? `${profile.gender} • ` : ''}
                  {profile.location ?? 'Unknown'}
                </Text>
                {profile.orientation ? (
                  <Text style={styles.meta}>Orientation: {profile.orientation}</Text>
                ) : null}
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
        {Array.isArray(profile.preferences) && profile.preferences.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Gender Preferences</Text>
            <View style={styles.chipsRow}>
              {profile.preferences.map((p, i) => (
                <View key={`${p}-${i}`} style={styles.chip}>
                  <Text style={styles.chipText}>{p}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {profile.about ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 14 }]}>About</Text>
            <Text style={styles.about}>{profile.about}</Text>
          </>
        ) : null}

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
              accessibilityLabel="Close photo viewer"
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
                contentContainerStyle={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: SCREEN_H,
                }}
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
  // Glass header
  headerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  headerGlass: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  headerBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    marginTop: 6,
  },
  headerProfilePic: { width: 32, height: 32, borderRadius: 16 },
  headerProfilePlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#888' },
  headerLogoImg: { width: 28, height: 28, tintColor: DRYNKS_WHITE },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: DRYNKS_BLUE },
  errorText: { color: DRYNKS_WHITE, marginBottom: 10, fontWeight: '600', fontSize: 16 },
  retryBtn: { backgroundColor: DRYNKS_RED, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: DRYNKS_WHITE, fontWeight: '700' },

  heroWrap: { width: SCREEN_W, height: HERO_H, backgroundColor: DRYNKS_BLUE },
  heroImage: { width: SCREEN_W, height: HERO_H, resizeMode: 'cover' },
  heroGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 180 },
  heroTextOverlay: { position: 'absolute', left: 16, right: 16, bottom: 20 },

  name: { color: DRYNKS_WHITE, fontSize: 32, fontWeight: '800', maxWidth: SCREEN_W - 120 },
  nameAge: { color: DRYNKS_WHITE, fontSize: 28, fontWeight: '700' },
  meta: { color: DRYNKS_WHITE, opacity: 0.95, marginTop: 4, fontSize: 14 },

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
  dotActive: { backgroundColor: DRYNKS_WHITE },

  sheet: {
    flex: 1,
    backgroundColor: DRYNKS_WHITE,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    marginTop: -18,
  },
  sectionTitle: { fontWeight: '800', color: DRYNKS_BLUE, marginBottom: 6, fontSize: 16 },
  about: { color: '#2A2F36', lineHeight: 20, marginBottom: 14 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.2)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 4,
  },
  chipText: { color: DRYNKS_BLUE, fontWeight: '700', fontSize: 12 },

  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cta: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPrimary: { backgroundColor: DRYNKS_RED },
  ctaSecondary: { backgroundColor: '#EEF0F2' },
  ctaText: { color: DRYNKS_WHITE, fontWeight: '800' },
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
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  closeX: { color: DRYNKS_WHITE, fontSize: 22, fontWeight: '800' },
  viewerCount: { color: DRYNKS_WHITE, fontWeight: '700' },
  viewerImg: { width: SCREEN_W, height: SCREEN_H, resizeMode: 'contain' },
});
