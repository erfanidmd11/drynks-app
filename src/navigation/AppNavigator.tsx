// src/navigation/AppNavigator.tsx
// Production ready; prefers server current_step, correct step order, deep links, safe onboarding resume
// Adds silent session restore + auth-change listener for refresh-token rotation.

import React, { useEffect, useState, useCallback, memo } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  type LinkingOptions,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@config/supabase';
import { navigationRef, onNavigationReady } from '@navigation/RootNavigation';
import type { RootStackParamList } from '../types/navigation';

// session bootstrap utilities (refresh-token restore + listener)
import { bootstrapSession, listenForAuthChanges } from '@utils/sessionBootstrap';

// Screens
import LoginScreen from '../screens/Auth/LoginScreen';
import MainTabBar from './MainTabBar';
import SplashScreen from '../screens/Onboarding/SplashScreen';
import SignupStepOne from '../screens/Onboarding/SignupStepOne';
import SignupStepTwo from '../screens/Onboarding/SignupStepTwo';
import SignupStepThree from '../screens/Onboarding/SignupStepThree';
import SignupStepFour from '../screens/Onboarding/SignupStepFour';
import SignupStepFive from '../screens/Onboarding/SignupStepFive';
import SignupStepSix from '../screens/Onboarding/SignupStepSix';
import SignupStepSeven from '../screens/Onboarding/SignupStepSeven';
import SignupStepEight from '../screens/Onboarding/SignupStepEight';
import SignupStepNine from '../screens/Onboarding/SignupStepNine';
import SignupStepTen from '../screens/Onboarding/SignupStepTen';
import SignupStepEleven from '../screens/Onboarding/SignupStepEleven';
import EnterOtpScreen from '../screens/EnterOtpScreen';

import InviteNearbyScreen from '../screens/Dates/InviteNearbyScreen';
import CreateDateScreen from '../screens/Dates/CreateDateScreen';
import MyDatesScreen from '../screens/Dates/MyDatesScreen';
import DateFeedScreen from '../screens/Home/DateFeedScreen';

import GroupChatScreen from '../screens/Messages/GroupChatScreen';
import MessagesScreen from '../screens/Messages/MessagesScreen';
import PrivateChatScreen from '../screens/Messages/PrivateChatScreen';

import ProfileDetailsScreen from '../screens/Profile/ProfileDetailsScreen';
import EditProfileScreen from '../screens/Profile/EditProfileScreen';

// Single export used for both MyInvites and ReceivedInvites aliases
import MyInvitesScreen from '../screens/Dates/ReceivedInvitesScreen';
import SentInvitesScreen from '../screens/Dates/SentInvitesScreen';
import MySentInvitesScreen from '../screens/Dates/MySentInvitesScreen';
import JoinRequestsScreen from '../screens/Dates/JoinRequestsScreen';
import ManageApplicantsScreen from '../screens/Dates/ManageApplicantsScreen';
import SettingsScreen from '../screens/Profile/SettingsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['dr-ynks://', 'https://dr-ynks.app.link', 'https://dr-ynks.page.link'],
  config: {
    screens: {
      // Deep links
      GroupChat: 'chat/:dateId',                 // <— open a chat by date id
      DateFeed: 'invite/:scrollToDateId',

      // Invites / requests
      MyInvites: 'received-invites',
      SentInvites: 'sent-invites',
      JoinRequests: 'join-requests',
      ManageApplicants: 'manage-applicants/:dateId?',

      // Profiles
      PublicProfile: 'profile/:userId',
    },
  },
};

// Wrapper to pass deep-link param via prop (no render function children)
type DateFeedWrapperProps = NativeStackScreenProps<RootStackParamList, 'DateFeed'>;
const DateFeedWrapper = memo(({ route, navigation }: DateFeedWrapperProps) => {
  const scrollToDateId = route?.params?.scrollToDateId;
  return (
    <DateFeedScreen
      route={route}
      navigation={navigation}
      scrollToDateId={scrollToDateId}
    />
  );
});

const ALLOWED_INITIAL_ROUTES = new Set<keyof RootStackParamList>([
  'Splash',
  'App',
  'Login',
  'EnterOtpScreen',
  'ProfileSetupStepOne',
  'ProfileSetupStepTwo',
  'ProfileSetupStepThree',
  'ProfileSetupStepFour',
  'ProfileSetupStepFive',
  'ProfileSetupStepSix',
  'ProfileSetupStepSeven',
  'ProfileSetupStepEight',
  'ProfileSetupStepNine',
  'ProfileSetupStepTen',
  'ProfileSetupStepEleven',
]);

const AppNavigator: React.FC = () => {
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList>('Splash');
  const [loading, setLoading] = useState(true);

  const clearLocalOnboardingIfLoggedOut = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove([
        'onboarding:wip_step',
        'onboarding:wip_payload',
        'onboarding_draft_v1',
      ]);
    } catch {
      // no-op
    }
  }, []);

  const getNextIncompleteStep = (profile: any): keyof RootStackParamList | null => {
    if (profile?.onboarding_complete) return null;
    if (!profile?.birthdate) return 'ProfileSetupStepTwo';
    if (!profile?.first_name || !profile?.screenname) return 'ProfileSetupStepThree';
    if (!profile?.phone) return 'ProfileSetupStepFour';
    if (!profile?.gender) return 'ProfileSetupStepFive';
    const prefs = profile?.preferences;
    if (!Array.isArray(prefs) || prefs.length === 0) return 'ProfileSetupStepSix';
    if (!profile?.orientation) return 'ProfileSetupStepSeven';
    if (!(profile?.social_handle || profile?.instagram_handle || profile?.tiktok_handle || profile?.facebook_handle))
      return 'ProfileSetupStepEight';
    if (!profile?.location) return 'ProfileSetupStepNine';
    const gallery = profile?.gallery_photos;
    if (!profile?.profile_photo || !Array.isArray(gallery) || gallery.length < 3)
      return 'ProfileSetupStepTen';
    if (!profile?.agreed_to_terms) return 'ProfileSetupStepEleven';
    return null;
  };

  useEffect(() => {
    let isMounted = true;
    const unsubscribeAuth = listenForAuthChanges();

    const bootstrap = async () => {
      try {
        await bootstrapSession();

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const current = data?.session ?? null;

        if (!current?.user?.id) {
          await clearLocalOnboardingIfLoggedOut();
          if (!isMounted) return;
          setInitialRoute('ProfileSetupStepOne');
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', current.user.id)
          .single();

        if (!isMounted) return;

        if (!profile) {
          setInitialRoute('ProfileSetupStepOne');
          return;
        }

        if (profile.onboarding_complete) {
          setInitialRoute('App');
          return;
        }

        if (profile.current_step && profile.current_step !== 'Complete') {
          const step = profile.current_step as keyof RootStackParamList;
          setInitialRoute(ALLOWED_INITIAL_ROUTES.has(step) ? step : 'App');
          return;
        }

        const next = getNextIncompleteStep(profile);
        setInitialRoute(next || 'App');
      } catch (e) {
        console.error('[INIT ERROR]', e);
        await clearLocalOnboardingIfLoggedOut();
        if (isMounted) setInitialRoute('ProfileSetupStepOne');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    bootstrap();

    return () => {
      isMounted = false;
      unsubscribeAuth();
    };
  }, [clearLocalOnboardingIfLoggedOut]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <ActivityIndicator size="large" color="#ff5a5f" />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      theme={DefaultTheme}
      onReady={onNavigationReady}
    >
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}
        initialRouteName={initialRoute}
      >
        {/* ---------- Auth + Onboarding ---------- */}
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="ProfileSetupStepOne" component={SignupStepOne} />
        <Stack.Screen name="EnterOtpScreen" component={EnterOtpScreen} />
        <Stack.Screen name="ProfileSetupStepTwo" component={SignupStepTwo} />
        <Stack.Screen name="ProfileSetupStepThree" component={SignupStepThree} />
        <Stack.Screen name="ProfileSetupStepFour" component={SignupStepFour} />
        <Stack.Screen name="ProfileSetupStepFive" component={SignupStepFive} />
        <Stack.Screen name="ProfileSetupStepSix" component={SignupStepSix} />
        <Stack.Screen name="ProfileSetupStepSeven" component={SignupStepSeven} />
        <Stack.Screen name="ProfileSetupStepEight" component={SignupStepEight} />
        <Stack.Screen name="ProfileSetupStepNine" component={SignupStepNine} />
        <Stack.Screen name="ProfileSetupStepTen" component={SignupStepTen} />
        <Stack.Screen name="ProfileSetupStepEleven" component={SignupStepEleven} />
        <Stack.Screen name="Login" component={LoginScreen} />

        {/* ---------- Main App (tabs) ---------- */}
        <Stack.Screen name="App" component={MainTabBar} />
        <Stack.Screen name="CreateDate" component={CreateDateScreen} />
        {/* Legacy alias (remove after migrating callers) */}
        <Stack.Screen name="New Date" component={CreateDateScreen} />
        <Stack.Screen name="InviteNearby" component={InviteNearbyScreen} />
        <Stack.Screen name="MyDates" component={MyDatesScreen} />

        {/* Date Feed (deep-link friendly via wrapper) */}
        <Stack.Screen name="DateFeed" component={DateFeedWrapper} />

        {/* ---------- Messaging / Profiles ---------- */}
        <Stack.Screen name="GroupChat" component={GroupChatScreen} />
        <Stack.Screen name="Messages" component={MessagesScreen} />
        <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
        <Stack.Screen name="Profile" component={ProfileDetailsScreen} />
        <Stack.Screen name="PublicProfile" component={ProfileDetailsScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />

        {/* ---------- Invites / Applicants (AppShell renders their header) ---------- */}
        <Stack.Screen name="MyInvites" component={MyInvitesScreen} />
        <Stack.Screen name="ReceivedInvites" component={MyInvitesScreen} />
        <Stack.Screen name="SentInvites" component={SentInvitesScreen} />
        <Stack.Screen name="MySentInvites" component={MySentInvitesScreen} />
        <Stack.Screen name="JoinRequests" component={JoinRequestsScreen} />
        <Stack.Screen name="ManageApplicants" component={ManageApplicantsScreen} />

        {/* ---------- Settings ---------- */}
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          // keep as-is; flip to false if Settings also renders AppShell internally
          options={{ headerShown: true, title: 'Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
