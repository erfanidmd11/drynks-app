// src/types/expo-notifications-fix.d.ts
declare module 'expo-notifications' {
  export type Subscription = { remove: () => void };

  export function getPermissionsAsync(): Promise<{ status: 'granted'|'denied'|'undetermined' }>;
  export function requestPermissionsAsync(): Promise<{ status: 'granted'|'denied'|'undetermined' }>;
  export function getExpoPushTokenAsync(opts?: { projectId?: string }): Promise<{ data: string }>;

  export function addNotificationReceivedListener(cb: (n:any)=>void): Subscription;
  export function addNotificationResponseReceivedListener(cb: (r:any)=>void): Subscription;

  export function setNotificationChannelAsync(name: string, channel: any): Promise<void>;

  // Needed by NotificationService.ts
  export function setNotificationHandler(handler: {
    handleNotification: (n: any) => Promise<{
      shouldShowAlert?: boolean;
      shouldPlaySound?: boolean;
      shouldSetBadge?: boolean;
    }>;
    handleSuccess?: (id: string) => Promise<void>;
    handleError?: (id: string, error: any) => Promise<void>;
  }): void;
}
