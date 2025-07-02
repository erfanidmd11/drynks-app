// AppNavigator.tsx
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import { supabase } from '../config/supabase';

import LoginScreen from '../screens/Auth/LoginScreen';
import MainTabBar from './MainTabBar';
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

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  const [session, setSession] = useState(null);
  const [initialRoute, setInitialRoute] = useState<string>('Login');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initialize = async () => {
      try {
        const { data: sessionData, error } = await supabase.auth.getSession();
        if (error) throw error;

        const currentSession = sessionData?.session ?? null;
        setSession(currentSession);

        if (!currentSession?.user?.id) {
          setInitialRoute('ProfileSetupStepOne');
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentSession.user.id)
          .single();

        if (profileError) throw profileError;

        const nextStep = getNextIncompleteStep(profile);
        setInitialRoute(nextStep || 'App');
      } catch (error) {
        console.error('[INIT ERROR]', error);
        setInitialRoute('ProfileSetupStepOne');
      } finally {
        setLoading(false);
      }
    };

    initialize();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  const getNextIncompleteStep = (profile: any): string | null => {
    if (!profile?.birthdate) return 'ProfileSetupStepTwo';
    if (!profile?.first_name || !profile?.username) return 'ProfileSetupStepThree';
    if (!profile?.phone) return 'ProfileSetupStepFour';
    if (!profile?.gender) return 'ProfileSetupStepFive';
    if (!Array.isArray(profile?.preferences) || profile.preferences.length === 0) return 'ProfileSetupStepSix';
    if (!profile?.agreed_to_terms) return 'ProfileSetupStepSeven';
    if (!profile?.social_handle || !profile?.social_platform) return 'ProfileSetupStepEight';
    if (!profile?.location) return 'ProfileSetupStepNine';
    if (!profile?.profile_photo || !Array.isArray(profile.gallery_photos) || profile.gallery_photos.length < 3)
      return 'ProfileSetupStepTen';
    return null;
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <ActivityIndicator size="large" color="#ff5a5f" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRoute}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="ProfileSetupStepOne" component={SignupStepOne} />
        <Stack.Screen name="ProfileSetupStepTwo" component={SignupStepTwo} />
        <Stack.Screen name="ProfileSetupStepThree" component={SignupStepThree} />
        <Stack.Screen name="ProfileSetupStepFour" component={SignupStepFour} />
        <Stack.Screen name="ProfileSetupStepFive" component={SignupStepFive} />
        <Stack.Screen name="ProfileSetupStepSix" component={SignupStepSix} />
        <Stack.Screen name="ProfileSetupStepSeven" component={SignupStepSeven} />
        <Stack.Screen name="ProfileSetupStepEight" component={SignupStepEight} />
        <Stack.Screen name="ProfileSetupStepNine" component={SignupStepNine} />
        <Stack.Screen name="ProfileSetupStepTen" component={SignupStepTen} />
        <Stack.Screen name="App" component={MainTabBar} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
