// App.tsx — Safe-mode for iOS 18: guard bad event emitters + no push listeners in prod

// ⚠️ Must be FIRST: install iOS 18 crash guard BEFORE any other imports (even polyfills)
import './src/boot/SafeEmitterShim';
import { unlockEmitters } from './src/boot/SafeEmitterShim';

// ---- polyfills MUST be before anything that might touch networking/crypto (e.g., supabase) ----
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import { decode as atobPolyfill, encode as btoaPolyfill } from 'base-64';
// @ts-ignore
if (typeof global.atob === 'undefined') global.atob = atobPolyfill;
// @ts-ignore
if (typeof global.btoa === 'undefined') global.btoa = btoaPolyfill;
// ---------------------------------------------------------------------------------------------

import React, { useEffect, useRef } from 'react';
import {
  AppState,
  AppStateStatus,
  InteractionManager,
  Platform,
  LogBox,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import AppNavigator from './src/navigation/AppNavigator';
import AppBootGate from './src/boot/AppBootGate';
import GlobalErrorBoundary from './src/boot/GlobalErrorBoundary';
import UltraSafeBoot from './src/boot/UltraSafeBoot';
import { supabase } from '@config/supabase';

// Optional: quiet some noisy warnings
LogBox.ignoreLogs(['Setting a timer']);

// ========= Runtime/env flags =========
const RAW_PUSH_FLAG =
  (process?.env?.EXPO_PUBLIC_DISABLE_PUSH ??
    (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_DISABLE_PUSH ??
    '0') as string;
const ENV_PUSH_DISABLED =
  RAW_PUSH_FLAG === '1' || RAW_PUSH_FLAG.toLowerCase?.() === 'true';
const PUSH_ALLOWED = __DEV__ && !ENV_PUSH_DISABLED;

const RAW_SAFE_BOOT =
  (process?.env?.EXPO_PUBLIC_SAFE_BOOT ??
    (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_SAFE_BOOT ??
    '1') as string;
const SAFE_BOOT =
  RAW_SAFE_BOOT === '1' || RAW_SAFE_BOOT.toLowerCase?.() === 'true';
// =====================================

// If you have a RootNavigation helper with a navigation ref, we’ll use it for breadcrumbs.
let getCurrentRouteSafe: (() => { name?: string } | undefined) | null = null;
try {
  // Typical pattern: export { navigationRef, navigate, getCurrentRoute } from RootNavigation
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RootNav = require('@navigation/RootNavigation');
  if (typeof RootNav?.getCurrentRoute === 'function') {
    getCurrentRouteSafe = () => {
      try {
        return RootNav.getCurrentRoute?.();
      } catch {
        return undefined;
      }
    };
  }
} catch {
  // Fallback: if RootNavigation isn’t available, breadcrumbs will be a no-op.
}

/** Deep-link navigation router from push payloads (kept for dev) */
function handleTapNavigation(data: any) {
  if (!data) return;
  try {
    // Lazy import to avoid circular deps at boot
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { navigate } = require('@navigation/RootNavigation');
    const t = data?.type as string | undefined;
    if (!t) {
      if (data?.date_id)
        navigate('DateFeed', {
          scrollToDateId: data.date_id,
          origin: 'Profile',
        } as any);
      return;
    }
    switch (t) {
      case 'INVITE_RECEIVED':
        navigate('MyInvites', {
          origin: 'Profile',
          inviteId: data?.invite_id,
          dateId: data?.date_id,
        } as any);
        break;
      case 'INVITE_ACCEPTED':
        navigate('MyDates', {
          origin: 'Profile',
          initialTab: 'Accepted',
          dateId: data?.date_id,
        } as any);
        break;
      case 'JOIN_REQUEST':
        navigate('MyDates', {
          origin: 'Profile',
          focus: 'JoinRequests',
          requestId: data?.request_id,
          dateId: data?.date_id,
        } as any);
        break;
      default:
        if (data?.date_id)
          navigate('DateFeed', {
            scrollToDateId: data.date_id,
            origin: 'Profile',
          } as any);
        break;
    }
  } catch (e) {
    console.warn('[PushTap] navigation error:', (e as Error)?.message);
  }
}

/**
 * Breadcrumb logger:
 * - Safe: doesn’t touch NavigationContainer props (since AppNavigator owns it)
 * - Uses RootNavigation.getCurrentRoute() if available
 * - Logs only on route change to avoid spam
 */
function BreadcrumbLogger() {
  const lastRouteRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const logIfChanged = () => {
      if (!getCurrentRouteSafe) return;
      const route = getCurrentRouteSafe();
      const name = route?.name;
      if (!name || cancelled) return;
      if (lastRouteRef.current !== name) {
        lastRouteRef.current = name;
        try {
          // This is the line you’ll scan for right before a native crash
          console.log('[Breadcrumb] route:', name);
        } catch {}
      }
    };

    // 1) Log after first frame
    InteractionManager.runAfterInteractions(() => {
      if (!cancelled) logIfChanged();
    });

    // 2) Log on app foreground
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        // small delay gives navigator time to settle
        setTimeout(logIfChanged, 200);
      }
    });

    // 3) Lightweight interval to catch route transitions (cleans itself up)
    const iv = setInterval(logIfChanged, 600);

    return () => {
      cancelled = true;
      try {
        sub.remove();
      } catch {}
      clearInterval(iv);
    };
  }, []);

  return null;
}

export default function App() {
  // Unlock emitter adds after app is active + first frame (paired with SafeEmitterShim)
  useEffect(() => {
    let cancelled = false;

    const unlockWhenReady = async () => {
      // Wait until foreground
      if (AppState.currentState !== 'active') {
        await new Promise<void>((resolve) => {
          const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
            if (s === 'active') {
              try {
                sub.remove();
              } catch {}
              resolve();
            }
          });
        });
      }
      // First frame
      await new Promise<void>((resolve) =>
        InteractionManager.runAfterInteractions(() => resolve())
      );
      if (!cancelled) {
        try {
          unlockEmitters();
        } catch {}
      }
    };

    void unlockWhenReady();
    return () => {
      cancelled = true;
    };
  }, []);

  // Start Supabase token auto-refresh (v2)
  useEffect(() => {
    // @ts-ignore
    supabase.auth.startAutoRefresh?.();
  }, []);

  // ✅ Keep Quick Unlock refresh token in sync with Supabase events (safe lazy require)
  useEffect(() => {
    let off: undefined | (() => void);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { attachQuickUnlockRotationListener } = require('@services/QuickUnlockService');
      off = attachQuickUnlockRotationListener();
    } catch (e) {
      console.warn(
        '[QuickUnlock] rotation listener failed to attach:',
        (e as Error)?.message
      );
    }
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, []);

  // Attach push listeners (DEV ONLY). In production this is a no-op.
  useEffect(() => {
    if (!PUSH_ALLOWED) return;

    const listenersAttachedRef = useRefLike(false);
    let cancelled = false;
    let cleanups: Array<() => void> = [];

    const safelyAttachPushListeners = async () => {
      // First frame
      await new Promise<void>((resolve) =>
        InteractionManager.runAfterInteractions(() => resolve())
      );
      // Small delay for nav readiness; iOS tends to need more
      await new Promise<void>((resolve) =>
        setTimeout(() => resolve(), Platform.OS === 'ios' ? 450 : 60)
      );
      if (cancelled || listenersAttachedRef.current) return;

      try {
        const Notifications = await import('expo-notifications');
        const { initNotificationsOnce } = await import('@services/NotificationService');

        await initNotificationsOnce();

        const receivedSub = Notifications.addNotificationReceivedListener((_n) => {});
        const tapSub = Notifications.addNotificationResponseReceivedListener(
          (response) => {
            const data = response?.notification?.request?.content?.data;
            handleTapNavigation(data);
          }
        );

        cleanups = [
          () => {
            try {
              receivedSub.remove();
            } catch {}
          },
          () => {
            try {
              tapSub.remove();
            } catch {}
          },
        ];

        listenersAttachedRef.current = true;
      } catch (e) {
        console.warn(
          '[PushInit] failed to attach listeners:',
          (e as Error)?.message
        );
      }
    };

    const kickOff = () => void safelyAttachPushListeners();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') kickOff();
    });
    if (AppState.currentState === 'active') kickOff();

    return () => {
      cancelled = true;
      try {
        sub.remove();
      } catch {}
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppBootGate>
          <GlobalErrorBoundary>
            {/* Breadcrumbs print [Breadcrumb] route: <Name> in device logs */}
            <BreadcrumbLogger />
            {/* Toggle safe boot on/off via EXPO_PUBLIC_SAFE_BOOT (default ON) */}
            {SAFE_BOOT ? <UltraSafeBoot /> : <AppNavigator />}
          </GlobalErrorBoundary>
        </AppBootGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function useRefLike<T>(initial: T) {
  const box = useRef<{ current: T }>({ current: initial });
  return box.current;
}
