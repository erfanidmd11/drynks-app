// src/navigation/MainTabBar.tsx – FINAL PRODUCTION READY
import React, { useState, useEffect } from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableOpacity,
  Text,
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

const Tab = createBottomTabNavigator();

const Logo = () => (
  <Image
    source={require('../../assets/images/DrYnks_Y_logo.png')}
    style={{ width: 36, height: 36 }}
    resizeMode="contain"
  />
);

const NotificationModal = ({ visible, onClose, notifications }) => {
  const navigation = useNavigation();
  return visible ? (
    <View style={styles.modalContainer}>
      <View style={styles.dropdown}>
        <Ionicons name="caret-up" size={20} color="#fff" style={styles.caret} />
        <View style={styles.dropdownContent}>
          {notifications.length === 0 ? (
            <Text style={{ color: '#999' }}>No notifications</Text>
          ) : (
            notifications.map((n, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => {
                  onClose();
                  if (n.screen && n.params) {
                    navigation.navigate(n.screen, n.params);
                  }
                }}
              >
                <Text style={{ paddingVertical: 6 }}>{n.message}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </View>
    </View>
  ) : null;
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
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) setNotifications(data);
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <NotificationModal
        visible={notificationVisible}
        onClose={() => setNotificationVisible(false)}
        notifications={notifications}
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
              count={notifications.length}
              onPress={() => setNotificationVisible(!notificationVisible)}
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
  },
  dropdownContent: {
    maxHeight: 200,
  },
  caret: {
    position: 'absolute',
    top: -10,
    right: 10,
  },
});

export default MainTabBar;
