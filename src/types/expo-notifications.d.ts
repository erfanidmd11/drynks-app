// types/expo-notifications.d.ts
declare module 'expo-notifications' {
  export interface NotificationBehavior {
    shouldShowAlert: boolean;
    shouldPlaySound: boolean;
    shouldSetBadge: boolean;
  }
}
