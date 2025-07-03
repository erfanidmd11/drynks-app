// AppNavigator.tsx – Production Ready & Crash Safe
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from '@config/supabase';
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
import SplashScreen from '../screens/Onboarding/SplashScreen';
import { View, ActivityIndicator } from 'react-native';

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  const [session, setSession] = useState(null);
  const [initialRoute, setInitialRoute] = useState<'Splash' | string>('Splash');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initialize = async () => {
      try {
        console.log('[INIT] Checking Supabase session...');
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const currentSession = sessionData?.session ?? null;
        setSession(currentSession);

        if (!currentSession?.user?.id) {
          console.warn('[INIT] No session found, routing to SignupStepOne');
          setInitialRoute('ProfileSetupStepOne');
          return;
        }

        console.log('[INIT] Fetching user profile...');
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentSession.user.id)
          .single();

        if (profileError || !profile) {
          console.warn('[INIT] Profile error or null, routing to SignupStepOne');
          setInitialRoute('ProfileSetupStepOne');
          return;
        }

        console.log('[INIT] Profile:', profile);
        const nextStep = getNextIncompleteStep(profile);
        console.log('[INIT] Routing to:', nextStep || 'App');
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

    const prefs = profile?.preferences;
    if (!Array.isArray(prefs) || prefs.length === 0) return 'ProfileSetupStepSix';

    if (!profile?.agreed_to_terms) return 'ProfileSetupStepSeven';
    if (!profile?.social_handle || !profile?.social_platform) return 'ProfileSetupStepEight';
    if (!profile?.location) return 'ProfileSetupStepNine';

    const gallery = profile?.gallery_photos;
    if (!profile?.profile_photo || !Array.isArray(gallery) || gallery.length < 3) {
      return 'ProfileSetupStepTen';
    }

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
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="ProfileSetupStepOne" component={SignupStepOne} />
        <Stack.Screen name="Login" component={LoginScreen} />
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
