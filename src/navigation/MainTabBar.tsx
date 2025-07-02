// Fully Cleaned MainTabBar.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateFeedScreen from '../screens/Home/DateFeedScreen';
import CreateDateScreen from '../screens/Dates/CreateDateScreen';
import MessagesScreen from '../screens/Messages/MessagesScreen';
import MyDatesScreen from '../screens/Dates/MyDatesScreen';
import ProfileMenu from '../components/common/ProfileMenu';

const Tab = createBottomTabNavigator();

const Logo = () => (
  <Image
    source={require('../../assets/images/DrYnks_Y_logo.png')}
    style={{ width: 36, height: 36, marginLeft: 16 }}
    resizeMode="contain"
  />
);

const MainTabBar = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerTitle: () => <Logo />, 
        headerRight: () => <ProfileMenu />,
        tabBarIcon: ({ color, size }) => {
          let iconName: string;
          switch (route.name) {
            case 'Explore':
              iconName = 'map';
              break;
            case 'My DrYnks':
              iconName = 'heart';
              break;
            case 'Vibe':
              iconName = 'chatbubble-ellipses';
              break;
            case 'New Date':
              iconName = 'add-circle';
              break;
            default:
              console.warn(`[TabBar] Unknown route: ${route.name}`);
              iconName = 'ellipse';
          }
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
