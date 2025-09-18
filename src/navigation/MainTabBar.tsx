import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableOpacity,
  Text,
  ScrollView,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@config/supabase';

import DateFeedScreen from '@screens/Home/DateFeedScreen';
import CreateDateScreen from '../screens/Dates/CreateDateScreen';
import MessagesScreen from '../screens/Messages/MessagesScreen';
import MyDatesScreen from '../screens/Dates/MyDatesScreen';
import ProfileMenu from '@components/common/ProfileMenu';
import NotificationBell from '@components/common/NotificationBell';

type DrYnksNotification = {
  id: string;
  user_id: string;
  type: 'invite_received' | 'invite_revoked' | 'invite_accepted' | 'join_request_received' | 'join_request_accepted' | 'generic';
  data?: any;
  read_at: string | null;
  created_at: string;
  title?: string | null;
  body?: string | null;
};

const Tab = createBottomTabNavigator();

const Logo = () => (
  <Image
    source={require('../../assets/images/DrYnks_Y_logo.png')}
    style={{ width: 36, height: 36 }}
    resizeMode="contain"
  />
);

const VALID_SCREENS = new Set([
  'Explore', 'My DrYnks', 'Vibe', 'New Date',
  'CreateDate', 'InviteNearby', 'MyDates', 'DateFeed',
  'GroupChat', 'Messages', 'PrivateChat', 'Profile', 'EditProfile', 'MyInvites',
  'SentInvites', 'MySentInvites', 'JoinRequests', 'Settings',
]);

const safeNavigate = (navigation: any, screen: string, params?: any) => {
  if (VALID_SCREENS.has(screen)) {
    navigation.navigate(screen as never, params as never);
  } else {
    console.warn(`❌ Invalid screen target: ${screen}`);
  }
};

const NotificationModal = ({
  visible,
  onClose,
  notifications,
  markAsReadAndNavigate,
}: {
  visible: boolean;
  onClose: () => void;
  notifications: DrYnksNotification[];
  markAsReadAndNavigate: (n: DrYnksNotification) => void;
}) => {
  const navigation = useNavigation<any>();
  if (!visible) return null;

  return (
    <View style={styles.modalContainer} pointerEvents="box-none">
      <View style={styles.dropdown}>
        <Ionicons name="caret-up" size={20} color="#fff" style={styles.caret} />
        <View style={styles.dropdownContent}>
          {notifications.length === 0 ? (
            <Text style={{ color: '#999' }}>No notifications</Text>
          ) : (
            <ScrollView style={{ maxHeight: 280 }}>
              {notifications.map((n) => {
                const isUnread = !n.read_at;
                const label =
                  n.title ||
                  (n.type === 'invite_received' && 'You received an invite') ||
                  (n.type === 'invite_accepted' && 'Your invite was accepted') ||
                  (n.type === 'join_request_received' && 'Someone requested to join your date') ||
                  'Notification';

                return (
                  <TouchableOpacity
                    key={n.id}
                    onPress={() => {
                      onClose();
                      markAsReadAndNavigate(n);
                    }}
                    style={{ paddingVertical: 8, opacity: isUnread ? 1 : 0.6 }}
                  >
                    <Text style={{ color: '#111', fontWeight: isUnread ? '700' : '500' }}>
                      {label}
                    </Text>
                    {!!n.body && <Text style={{ color: '#666', fontSize: 12 }}>{n.body}</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
};

const getIconName = (routeName: string) => {
  switch (routeName) {
    case 'Explore':
      return 'map';
    case 'My DrYnks':
      return 'heart';
    case 'Vibe':
      return 'chatbubble-ellipses';
    case 'New Date':
      return 'add-circle';
    default:
      return 'ellipse';
  }
};

const MainTabBar = () => {
  const [notificationVisible, setNotificationVisible] = useState(false);
  const [notifications, setNotifications] = useState<DrYnksNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const navigation = useNavigation<any>();

  const recalcUnread = useCallback((rows: DrYnksNotification[]) => {
    setUnreadCount(rows.filter((r) => !r.read_at).length);
  }, []);

  const fetchForUser = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      console.warn('[MainTabBar] notifications fetch error', error);
      return;
    }
    setNotifications((data || []) as DrYnksNotification[]);
    recalcUnread((data || []) as DrYnksNotification[]);
  }, [recalcUnread]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id || null;
      setUserId(uid);
      if (uid) await fetchForUser(uid);
    })();
  }, [fetchForUser]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('notifications_user_feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setNotifications((prev) => {
            const rows = [...prev];
            const idx = rows.findIndex((r) => r.id === (payload.new as any)?.id);
            if (payload.eventType === 'DELETE') {
              return rows.filter((r) => r.id !== (payload.old as any)?.id);
            }
            if (idx >= 0) {
              rows[idx] = payload.new as any;
              return rows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
            }
            rows.unshift(payload.new as any);
            return rows.slice(0, 50);
          });
        }
      )
      .subscribe();

    pollRef.current = setInterval(() => fetchForUser(userId), 30000);

    return () => {
      channel.unsubscribe();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [userId, fetchForUser]);

  useEffect(() => {
    recalcUnread(notifications);
  }, [notifications, recalcUnread]);

  const navFromNotification = useCallback((n: DrYnksNotification) => {
    const data = n?.data || {};
    switch (n.type) {
      case 'invite_received':
        return { screen: 'MyInvites', params: undefined };
      case 'invite_accepted':
        return { screen: 'MyDates', params: { initialTab: 'Accepted', dateId: data?.dateId || data?.date_id } };
      case 'join_request_received':
        return { screen: 'JoinRequests', params: undefined };
      default:
        if (data?.screen && VALID_SCREENS.has(data.screen)) {
          return { screen: data.screen as string, params: data.params };
        }
        return { screen: 'Explore', params: undefined };
    }
  }, []);

  const markAsReadAndNavigate = useCallback(async (n: DrYnksNotification) => {
    try {
      if (!n.read_at) {
        await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', n.id);
      }
    } catch (e) {
      console.warn('[MainTabBar] mark read error', e);
    }
    const target = navFromNotification(n);
    safeNavigate(navigation, target.screen, target.params);
  }, [navigation, navFromNotification]);

  return (
    <>
      <NotificationModal
        visible={notificationVisible}
        onClose={() => setNotificationVisible(false)}
        notifications={notifications}
        markAsReadAndNavigate={markAsReadAndNavigate}
      />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerTitle: () => <Logo />,
          headerLeft: () => (
            <View style={{ marginLeft: 16 }}>
              <ProfileMenu />
            </View>
          ),
          headerRight: () => (
            <NotificationBell
              count={unreadCount}
              onPress={() => setNotificationVisible((v) => !v)}
            />
          ),
          tabBarIcon: ({ color, size }) => {
            const iconName = getIconName(route.name);
            return <Ionicons name={iconName as any} size={size} color={color} />;
          },
          tabBarActiveTintColor: '#ff5a5f',
          tabBarInactiveTintColor: 'gray',
        })}
      >
        <Tab.Screen name="Explore" component={DateFeedScreen} />
        <Tab.Screen name="My DrYnks" component={MyDatesScreen} />
        <Tab.Screen name="Vibe" component={MessagesScreen} />
        <Tab.Screen name="New Date" component={CreateDateScreen} />
      </Tab.Navigator>
    </>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    position: 'absolute',
    top: 60,
    right: 16,
    zIndex: 999,
  },
  dropdown: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
    minWidth: 260,
  },
  dropdownContent: {
    maxHeight: 300,
    gap: 6,
  },
  caret: {
    position: 'absolute',
    top: -10,
    right: 10,
  },
});

export default MainTabBar;
