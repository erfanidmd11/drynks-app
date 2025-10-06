// src/screens/Profile/ProfileDetailsScreen.tsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useCallback,
} from 'react';
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
  Alert,
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

type RouteParams = {
  userId?: string;
  origin?: string;
  preferHeader?: boolean;
  dateId?: string | null;
  afterInviteRoute?: { tab?: string; screen?: string; inner?: string };
  returnTo?: { name: string; params?: any };
};

type ProfileRow = {
  id: string;
  screenname?: string | null;
  profile_photo?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  location?: string | null;
  preferences?: string[] | null;
  orientation?: string | null | string[];
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
  const bg = tint === 'dark' ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.65)';
  const border =
    tint === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.08)';

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

// ---- Glass Back Button (for custom header mode)
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

// ---- Notifications (robust against schema variations)
async function insertNotification(base: {
  user_id: string;
  type: string; // preferred if column exists
  title: string;
  body?: string | null;
  data?: Record<string, any> | null;
}) {
  const { error: e1 } = await supabase.from('notifications').insert([base]);
  if (!e1) return true;

  // Try alternative shapes (older schema)
  const msg = String(e1?.message || '').toLowerCase();
  if (!msg.includes(`'type'`) && !msg.includes('type') && !msg.includes('schema cache')) {
    throw e1;
  }

  const { error: e2 } = await supabase.from('notifications').insert([
    {
      user_id: base.user_id,
      event_type: base.type,
      title: base.title,
      body: base.body ?? null,
      data: base.data ?? null,
    },
  ]);
  if (!e2) return true;

  const { error: e3 } = await supabase.from('notifications').insert([
    {
      user_id: base.user_id,
      title: base.title,
      body: base.body ?? null,
      data: { ...(base.data || {}), kind: base.type },
    },
  ]);
  if (!e3) return true;

  throw e3;
}

export default function ProfileDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute() as any;
  const insets = useSafeAreaInsets();

  const {
    userId: routeUserId,
    origin,
    preferHeader = false,
    dateId: ctxDateId = null,
    afterInviteRoute,
    returnTo,
  } = (route.params || {}) as RouteParams;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | null>(
    routeUserId ?? null
  );
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState(false);

  // Header sizing (only used when using the custom glass header)
  const TOP_ROW = 44;
  const BACK_ROW = 48;
  const HEADER_SPACING = 10;
  const HEADER_H = insets.top + TOP_ROW + BACK_ROW + HEADER_SPACING;

  // Viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const heroRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(0);

  // ---- Smart back: prefer pop; then route.returnTo; then origin; then safe app route
  const smartBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    // Try explicit returnTo first
    if (returnTo?.name) {
      try { navigation.navigate(returnTo.name as never, (returnTo.params || {}) as never); return; } catch {}
      try { navigation.getParent()?.navigate(returnTo.name as never, (returnTo.params || {}) as never); return; } catch {}
    }

    const tryNavigate = (name?: string) => {
      if (!name) return false;
      try { navigation.navigate(name as never); return true; } catch {}
      try { navigation.getParent()?.navigate(name as never); return true; } catch {}
      try { navigation.getParent()?.getParent()?.navigate(name as never); return true; } catch {}
      return false;
    };

    if (origin && tryNavigate(origin)) return;

    const candidates = [
      'My DrYnks', 'MyDates', 'ManageApplicants', 'MySentInvites',
      'JoinRequests', 'ReceivedInvites', 'Explore', 'DateFeed',
    ];
    for (const name of candidates) {
      if (tryNavigate(name)) return;
      try { navigation.navigate('App' as never, { screen: name } as never); return; } catch {}
    }
    try { navigation.navigate('App' as never); } catch {}
  }, [navigation, origin, returnTo]);

  // Resolve session and "me" + default target + my avatar
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id ?? null;
      if (!mounted) return;
      setMe(uid);
      if (!routeUserId && uid) setTargetUserId(uid);

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

  // Fetch viewed profile
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

  useEffect(() => {
    initialFetch();
  }, [initialFetch]);

  // Refresh on focus
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

  // Live updates
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

  // Images
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

  // ---- Native header toggle (preferHeader)
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: preferHeader,
      headerTitle: profile?.screenname || 'Profile',
      headerBackTitleVisible: false,
    });
  }, [navigation, preferHeader, profile?.screenname]);

  // ---------- Invite flow ----------
  const goToAfterInvite = useCallback(() => {
    const a = afterInviteRoute || { tab: 'App', screen: 'My DrYnks', inner: 'MyDates' };

    // Try hierarchy: tab -> screen (inside tab) -> inner
    if (a.tab) {
      try {
        if (a.screen) {
          // Nested: App → screen(tab) → inner
          if (a.inner) {
            navigation.navigate(a.tab as never, { screen: a.screen, params: { screen: a.inner } } as never);
          } else {
            navigation.navigate(a.tab as never, { screen: a.screen } as never);
          }
          return;
        }
        navigation.navigate(a.tab as never);
        return;
      } catch {}
    }

    // Direct tries
    try { navigation.navigate('App' as never, { screen: 'My DrYnks' } as never); return; } catch {}
    try { navigation.getParent()?.navigate('My DrYnks' as never); return; } catch {}
    try { navigation.getParent()?.navigate('MyDates' as never); return; } catch {}

    navigation.reset({ index: 0, routes: [{ name: 'App' as never, params: { screen: 'My DrYnks' } as never }] as any });
  }, [afterInviteRoute, navigation]);

  // Dual-write (date_requests + invites), idempotent
  const sendInvite = useCallback(
    async (hostId: string, toUserId: string, dateId: string) => {
      // Quick dedupe
      const [{ data: existsDR }, { data: existsLegacy }] = await Promise.all([
        supabase
          .from('date_requests')
          .select('id,status')
          .eq('date_id', dateId)
          .eq('requester_id', hostId)
          .eq('recipient_id', toUserId)
          .limit(1),
        supabase
          .from('invites')
          .select('id,status')
          .eq('date_id', dateId)
          .eq('inviter_id', hostId)
          .eq('invitee_id', toUserId)
          .limit(1),
      ]);

      const alreadyPendingDR = Array.isArray(existsDR) && existsDR.some(r => r?.status === 'pending');
      const alreadyPendingLegacy = Array.isArray(existsLegacy) && existsLegacy.some(r => r?.status === 'pending');

      if (!alreadyPendingDR) {
        const { error: e1 } = await supabase
          .from('date_requests')
          .insert([{ date_id: dateId, requester_id: hostId, recipient_id: toUserId, status: 'pending' }]);
        if (e1 && e1.code !== '23505') throw e1;
      }

      if (!alreadyPendingLegacy) {
        const { error: e2 } = await supabase
          .from('invites')
          .insert([{ date_id: dateId, inviter_id: hostId, invitee_id: toUserId, status: 'pending' }]);
        if (e2 && e2.code !== '23505') throw e2;
      }

      // Best‑effort notification
      try {
        await insertNotification({
          user_id: toUserId,
          type: 'invite',
          title: 'You have a DrYnks invite 🍸',
          body: 'Open the app to view and respond.',
          data: { action: 'invite_inapp', date_id: dateId, inviter_id: hostId },
        });
      } catch {
        /* non-fatal */
      }
    },
    []
  );

  const onInviteToDate = useCallback(async () => {
    // If we have a dateId context (came from Invite Nearby), send the invite immediately
    if (ctxDateId && profile?.id) {
      if (!me) {
        Alert.alert('Not signed in', 'Please sign in again.');
        return;
      }
      if (inviting || invited) return;

      setInviting(true);
      try {
        await sendInvite(me, profile.id, ctxDateId);
        setInvited(true);
        Alert.alert('Invite sent', profile.screenname || 'Guest');
        goToAfterInvite();
      } catch (err: any) {
        Alert.alert('Invite failed', err?.message || 'Please try again.');
      } finally {
        setInviting(false);
      }
      return;
    }

    // No dateId context → go to My DrYnks (footer) instead of CreateDate
    try {
      navigation.navigate('App' as never, { screen: 'My DrYnks', params: { screen: 'MyDates' } } as never);
    } catch {
      // final fallback
      navigation.reset({ index: 0, routes: [{ name: 'App' as never, params: { screen: 'My DrYnks' } as never }] as any });
    }
  }, [ctxDateId, profile?.id, profile?.screenname, me, inviting, invited, sendInvite, goToAfterInvite, navigation]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (i !== index) setIndex(i);
  };

  const onMessage = () => navigation.navigate('PrivateChat', { toUserId: profile?.id });

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
        <TouchableOpacity onPress={smartBack} style={styles.retryBtn}>
          <Text style={styles.retryText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // When using native header, don't push down the content as much
  const containerTopPad = preferHeader ? Math.max(insets.top, 4) : HEADER_H;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DRYNKS_BLUE, paddingTop: containerTopPad }}>
      <StatusBar barStyle="light-content" />

      {/* Custom header only when NOT preferring native header */}
      {!preferHeader && (
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
              <GlassBackButton onPress={smartBack} tint="dark" label="Back" color="#fff" />
              <View style={{ width: 48 }} />
            </View>
          </SoftGlass>
        </View>
      )}

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
                  <Text style={styles.meta}>
                    Orientation:{' '}
                    {Array.isArray(profile.orientation)
                      ? profile.orientation.join(', ')
                      : profile.orientation}
                  </Text>
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
              <TouchableOpacity
                onPress={onInviteToDate}
                style={[styles.cta, styles.ctaSecondary, (inviting || invited) && { opacity: 0.7 }]}
                disabled={inviting || invited}
                accessibilityState={{ disabled: inviting || invited }}
              >
                <Text style={styles.ctaTextDark}>
                  {invited ? 'Invited' : 'Invite to Date'}
                </Text>
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
  // Glass header (custom mode)
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
