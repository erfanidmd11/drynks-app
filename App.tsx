// App.tsx
import React, { useEffect } from 'react';
import { LogBox, View, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import 'react-native-url-polyfill/auto';

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './src/config/supabase'; // adjust path if needed

LogBox.ignoreLogs(['Setting a timer']); // Optional, to ignore known harmless warnings

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('🔥 [Root Crash]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text>Something went wrong.</Text>
          <Text>{this.state.error?.message}</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const registerForPushNotifications = async () => {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  if (userId && token) {
    await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
  }
};

export default function App() {
  useEffect(() => {
    registerForPushNotifications();
  }, []);

  console.log('✅ App.tsx Loaded');

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AppNavigator />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
