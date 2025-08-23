// src/navigation/AppNavigator.tsx
// Production ready; respects onboarding_complete, optional Step 8, deep links

import React, { useEffect, useState, useCallback } from 'react';
import { NavigationContainer, DefaultTheme, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@config/supabase';
import { navigationRef, onNavigationReady } from '@navigation/RootNavigation';
import type { RootStackParamList } from '../types/navigation'; // <-- SSOT (fixed path)

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
import MyInvitesScreen from '../screens/Dates/ReceivedInvitesScreen';
import SentInvitesScreen from '../screens/Dates/SentInvitesScreen';
import MySentInvitesScreen from '../screens/Dates/MySentInvitesScreen';
import JoinRequestsScreen from '../screens/Dates/JoinRequestsScreen';
import MyApplicantsScreen from '../screens/Dates/MyApplicantsScreen';
import ManageApplicantsScreen from '../screens/Dates/ManageApplicantsScreen';
import SettingsScreen from '../screens/Profile/SettingsScreen';

// Use a relaxed Stack type to avoid friction while routes/types evolve
const Stack = createNativeStackNavigator<any>();

// ------- Deep link config (relaxed typing) -------
const linking: LinkingOptions<any> = {
  prefixes: ['dr-ynks://', 'https://dr-ynks.app.link', 'https://dr-ynks.page.link'],
  config: {
    screens: {
      DateFeed: 'invite/:scrollToDateId',
      MyInvites: 'received-invites',
      SentInvites: 'sent-invites',
      JoinRequests: 'join-requests',
      MyApplicants: 'my-applicants',
      ManageApplicants: 'manage-applicants/:dateId?',
      PublicProfile: 'profile/:userId',
    },
  },
};

const AppNavigator = () => {
  // Keep it string to satisfy React Navigation even if the SSOT doesn't include a route yet
  const [initialRoute, setInitialRoute] = useState<string>('Splash');
  const [loading, setLoading] = useState(true);
  const [deepLinkDateId, setDeepLinkDateId] = useState<string | undefined>(undefined);

  const clearLocalOnboardingIfLoggedOut = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove(['onboarding:wip_step', 'onboarding:wip_payload']);
    } catch {}
  }, []);

  const hasAnySocialHandle = (profile: any) =>
    Boolean(
      profile?.social_handle ||
        profile?.instagram_handle ||
        profile?.tiktok_handle ||
        profile?.facebook_handle
    );

  const getNextIncompleteStep = (profile: any): keyof RootStackParamList | null => {
    if (profile?.onboarding_complete) return null;

    if (!profile?.birthdate) return 'ProfileSetupStepTwo';
    if (!profile?.first_name || !profile?.screenname) return 'ProfileSetupStepThree';
    if (!profile?.phone) return 'ProfileSetupStepFour';
    if (!profile?.gender) return 'ProfileSetupStepFive';

    const prefs = profile?.preferences;
    if (!Array.isArray(prefs) || prefs.length === 0) return 'ProfileSetupStepSix';
    if (!profile?.agreed_to_terms) return 'ProfileSetupStepSeven';

    if (!hasAnySocialHandle(profile)) return 'ProfileSetupStepEight';

    if (!profile?.location) return 'ProfileSetupStepNine';
    const gallery = profile?.gallery_photos;
    if (!profile?.profile_photo || !Array.isArray(gallery) || gallery.length < 3)
      return 'ProfileSetupStepTen';
    if (!profile?.orientation) return 'ProfileSetupStepEleven';

    return null;
  };

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
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

        if (!profile) {
          if (!isMounted) return;
          setInitialRoute('ProfileSetupStepOne');
          return;
        }

        if (profile.onboarding_complete) {
          if (!isMounted) return;
          setInitialRoute('App');
          return;
        }

        const next = getNextIncompleteStep(profile);
        if (!isMounted) return;
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
    };
  }, [clearLocalOnboardingIfLoggedOut]);

  const syncDeepLinkParamFromNavState = useCallback(() => {
    try {
      const route = navigationRef.getCurrentRoute();
      if (route?.name === 'DateFeed') {
        const id = (route.params as any)?.scrollToDateId as string | undefined;
        setDeepLinkDateId(id);
      }
    } catch {}
  }, []);

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
      theme={{ ...DefaultTheme }}
      onReady={() => {
        onNavigationReady();
        syncDeepLinkParamFromNavState();
      }}
      onStateChange={syncDeepLinkParamFromNavState}
    >
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}
        initialRouteName={initialRoute}
      >
        {/* Onboarding & Auth */}
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

        {/* App */}
        <Stack.Screen name="App" component={MainTabBar} />
        <Stack.Screen name="CreateDate" component={CreateDateScreen} />
        <Stack.Screen name="InviteNearby" component={InviteNearbyScreen} />
        <Stack.Screen name="MyDates" component={MyDatesScreen} />
        <Stack.Screen
          name="DateFeed"
          component={(props: any) => <DateFeedScreen {...props} scrollToDateId={deepLinkDateId} />}
        />
        <Stack.Screen name="GroupChat" component={GroupChatScreen} />
        <Stack.Screen name="Messages" component={MessagesScreen} />
        <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />

        {/* Profile */}
        <Stack.Screen name="Profile" component={ProfileDetailsScreen} />
        <Stack.Screen name="PublicProfile" component={ProfileDetailsScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />

        {/* Invites / Requests */}
        <Stack.Screen name="MyInvites" component={MyInvitesScreen} />
        <Stack.Screen name="SentInvites" component={SentInvitesScreen} />
        <Stack.Screen name="MySentInvites" component={MySentInvitesScreen} />
        <Stack.Screen name="JoinRequests" component={JoinRequestsScreen} />

        {/* Applicants */}
        <Stack.Screen name="MyApplicants" component={MyApplicantsScreen} />
        <Stack.Screen name="ManageApplicants" component={ManageApplicantsScreen} />

        {/* Settings */}
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ headerShown: true, title: 'Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
