// Fully Cleaned MainTabBar.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import DateFeedScreen from '@screens/Home/DateFeedScreen';
import CreateDateScreen from '../screens/Dates/CreateDateScreen';
import MessagesScreen from '../screens/Messages/MessagesScreen';
import MyDatesScreen from '../screens/Dates/MyDatesScreen';
import ProfileMenu from '@components/common/ProfileMenu';

const Tab = createBottomTabNavigator();

const Logo = () => (
  <Image
    source={require('../../assets/images/DrYnks_Y_logo.png')}
    style={{ width: 36, height: 36, marginLeft: 16 }}
    resizeMode="contain"
  />
);

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
      if (__DEV__) {
        console.warn(`[TabBar] Unknown route: ${routeName}`);
      }
      return 'ellipse';
  }
};

const MainTabBar = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerTitle: () => <Logo />,
        headerRight: () => <ProfileMenu />,
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
  );
};

export default MainTabBar;
