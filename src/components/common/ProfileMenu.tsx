// src/components/common/ProfileMenu.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Modal,
  Alert,
  Image,
  Animated,
  Easing,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#E1EBF2';
const DRYNKS_WHITE = '#FFFFFF';

const AVATAR_FALLBACK =
  'https://cdn-icons-png.flaticon.com/512/847/847969.png';

type UnreadCounts = {
  invite_received: number;
  join_request_received: number;
  invite_accepted: number;
};

const ProfileMenu: React.FC = () => {
  const navigation = useNavigation<any>();
  const [visible, setVisible] = useState(false);
  const [profileUrl, setProfileUrl] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [counts, setCounts] = useState<UnreadCounts>({
    invite_received: 0,
    join_request_received: 0,
    invite_accepted: 0,
  });

  // animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.96)).current;

  // ───────────────── Load avatar + user id ─────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) return;
        setCurrentUserId(userId);

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('profile_photo')
          .eq('id', userId)
          .single();

        if (!error && profile?.profile_photo) {
          if (profile.profile_photo.startsWith('http')) {
            setProfileUrl(profile.profile_photo);
          } else {
            const { data: pub } = supabase
              .storage
              .from('profile-photos')
              .getPublicUrl(profile.profile_photo);
            setProfileUrl(pub?.publicUrl || '');
          }
        }
      } catch (e) {
        console.warn('[ProfileMenu] load avatar failed', e);
      }
    })();
  }, []);

  // ───────────────── Notifications: unread counts ─────────────────
  const fetchUnreadCounts = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('type')
        .eq('user_id', userId)
        .is('read_at', null);

    if (error) throw error;

      const tally: UnreadCounts = {
        invite_received: 0,
        join_request_received: 0,
        invite_accepted: 0,
      };

      (data ?? []).forEach((r: any) => {
        if (r?.type in tally) (tally as any)[r.type] += 1;
      });

      setCounts(tally);
    } catch (e) {
      console.warn('[ProfileMenu] fetchUnreadCounts error', e);
    }
  }, []);

  useEffect(() => {
    if (currentUserId) fetchUnreadCounts(currentUserId);
  }, [currentUserId, fetchUnreadCounts]);

  // Refresh counts whenever the menu opens
  useEffect(() => {
    if (visible && currentUserId) fetchUnreadCounts(currentUserId);
  }, [visible, currentUserId, fetchUnreadCounts]);

  // Mark read for specific types, then refresh counters
  const markReadForTypes = useCallback(
    async (types: string[]) => {
      if (!currentUserId || !types.length) return;
      try {
        await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('user_id', currentUserId)
          .in('type', types)
          .is('read_at', null);
        await fetchUnreadCounts(currentUserId);
      } catch (e) {
        console.warn('[ProfileMenu] markReadForTypes error', e);
      }
    },
    [currentUserId, fetchUnreadCounts]
  );

  // ───────────────── Menu open/close ─────────────────
  const showMenu = () => {
    setVisible(true);
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.96);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        bounciness: 6,
        speed: 18,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const hideMenu = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  };

  // ───────────────── Actions ─────────────────
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      hideMenu();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (err) {
      console.error('[Logout Error]', err);
      Alert.alert('Logout Failed', 'Something went wrong.');
    }
  };

  const goToMyProfile = async () => {
    try {
      let uid = currentUserId;
      if (!uid) {
        const { data } = await supabase.auth.getUser();
        uid = data?.user?.id || '';
        if (uid) setCurrentUserId(uid);
      }
      hideMenu();
      navigation.navigate('Profile', uid ? { userId: uid } : undefined);
    } catch {
      hideMenu();
      navigation.navigate('Profile');
    }
  };

  const goToSettings = () => {
    hideMenu();
    navigation.navigate('Settings');
  };

  const goToReceivedInvites = async () => {
    await markReadForTypes(['invite_received']);
    hideMenu();
    navigation.navigate('MyInvites'); // ReceivedInvitesScreen
  };

  const goToJoinRequests = async () => {
    await markReadForTypes(['join_request_received']);
    hideMenu();
    navigation.navigate('JoinRequests'); // JoinRequestsScreen
  };

  const goToSentInvites = async () => {
    hideMenu();
    try {
      navigation.navigate('MySentInvites');
    } catch {
      navigation.navigate('SentInvites');
    }
  };

  // ───────────────── Applicants ─────────────────
  const goToMyApplicants = () => {
    hideMenu();
    // Robust: try several route names in case navigator labels differ
    try { navigation.navigate('MyApplicants'); return; } catch {}
    try { navigation.navigate('Applicants'); return; } catch {}
    try { navigation.navigate('ApplicantsList'); return; } catch {}
    try { navigation.navigate('Dates', { screen: 'MyApplicants' }); return; } catch {}
  };

  const goToManageApplicants = () => {
    hideMenu();
    // Primary route name we’ll register in AppNavigator:
    try { navigation.navigate('ManageApplicants'); return; } catch {}
    // Fallbacks if an older name exists in your project:
    try { navigation.navigate('ApplicantsManage'); return; } catch {}
    try { navigation.navigate('ApplicantsManager'); return; } catch {}
  };

  // ───────────────── Small badge ─────────────────
  const Badge = ({ count }: { count: number }) =>
    count > 0 ? (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{count > 99 ? '99+' : String(count)}</Text>
      </View>
    ) : null;

  // ───────────────── Render ─────────────────
  return (
    <View style={{ marginLeft: 12 }}>
      <TouchableOpacity
        onPress={showMenu}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Open profile menu"
      >
        <Image
          source={{ uri: profileUrl || AVATAR_FALLBACK }}
          style={styles.avatar}
          onError={() => setProfileUrl('')}
        />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="none" onRequestClose={hideMenu}>
        {/* Tap outside to close */}
        <TouchableOpacity style={styles.overlay} onPress={hideMenu} activeOpacity={1}>
          <Animated.View
            style={[
              styles.menu,
              { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
            ]}
          >
            <Text style={styles.title}>Your Profile</Text>

            <TouchableOpacity onPress={goToMyProfile} accessibilityRole="button" style={styles.row}>
              <Text style={styles.item}>My Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={goToReceivedInvites} accessibilityRole="button" style={styles.row}>
              <Text style={styles.item}>Received Invites</Text>
              <Badge count={counts.invite_received} />
            </TouchableOpacity>

            <TouchableOpacity onPress={goToSentInvites} accessibilityRole="button" style={styles.row}>
              <Text style={styles.item}>Sent Invites</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={goToJoinRequests} accessibilityRole="button" style={styles.row}>
              <Text style={styles.item}>Join Requests</Text>
              <Badge count={counts.join_request_received} />
            </TouchableOpacity>

            {/* Applicants */}
            <TouchableOpacity onPress={goToMyApplicants} accessibilityRole="button" style={styles.row}>
              <Text style={styles.item}>My Applicants</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={goToManageApplicants} accessibilityRole="button" style={styles.row}>
              <Text style={styles.item}>Manage Applicants</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={goToSettings} accessibilityRole="button" style={styles.row}>
              <Text style={styles.item}>Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleLogout} accessibilityRole="button" style={styles.row}>
              <Text style={styles.item}>Logout</Text>
            </TouchableOpacity>

            {/* ⛔️ Keep destructive "Delete Profile" inside Settings */}
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: DRYNKS_GRAY,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: 60,
    paddingLeft: 20,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  menu: {
    width: 260,
    backgroundColor: DRYNKS_WHITE,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
  title: {
    fontWeight: '700',
    fontSize: 16,
    color: DRYNKS_BLUE,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  item: { fontSize: 15, color: DRYNKS_BLUE, flex: 1, marginRight: 10 },
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 11,
    backgroundColor: DRYNKS_RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: DRYNKS_WHITE, fontWeight: '800', fontSize: 12 },
});

export default ProfileMenu;
