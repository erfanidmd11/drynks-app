// NotificationService.ts – Registers and Stores Expo Push Token in Supabase
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Alert, Platform } from 'react-native';
import { supabase } from '@config/supabase';

export const registerForPushNotificationsAsync = async () => {
  try {
    let token;

    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        Alert.alert('Permission denied', 'Enable notifications to stay updated!');
        return;
      }

      const { data } = await Notifications.getExpoPushTokenAsync();
      token = data;

      console.log('Expo Push Token:', token);

      const session = await supabase.auth.getSession();
      const userId = session?.data?.session?.user?.id;

      if (userId && token) {
        await supabase.from('profiles').update({ push_token: token }).eq('id', userId);
        console.log('Push token saved to Supabase.');
      }
    } else {
      Alert.alert('Push notifications only work on physical devices.');
    }

    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }
  } catch (err) {
    console.error('[Push Registration Error]', err);
  }
};
