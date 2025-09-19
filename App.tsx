// App.tsx — Production-ready with iOS18 safety + push enabled (lazy + safe)

// ------------- iOS18 crash guard must be first -------------
import './src/boot/SafeEmitterShim';
import { unlockEmitters } from './src/boot/SafeEmitterShim';

// ------------- polyfills (before anything that touches net/crypto) -------------
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import './src/boot/polyfills';
import { decode as atobPolyfill, encode as btoaPolyfill } from 'base-64';
// @ts-ignore
if (typeof global.atob === 'undefined') global.atob = atobPolyfill;
// @ts-ignore
if (typeof global.btoa === 'undefined') global.btoa = btoaPolyfill;

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
import { initInviteDeepLinking } from '@services/InviteLinks'; // capture /invite/<code> + ?code= links

LogBox.ignoreLogs(['Setting a timer']);

/* -------------------- env flags -------------------- */
const RAW_PUSH_FLAG =
  (process?.env?.EXPO_PUBLIC_DISABLE_PUSH ??
    (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_DISABLE_PUSH ??
    '0') as string;
const PUSH_DISABLED =
  RAW_PUSH_FLAG === '1' || RAW_PUSH_FLAG.toLowerCase?.() === 'true';

// Push is **allowed** in production when not explicitly disabled
const PUSH_ALLOWED = !PUSH_DISABLED;

const RAW_SAFE_BOOT =
  (process?.env?.EXPO_PUBLIC_SAFE_BOOT ??
    (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_SAFE_BOOT ??
    '1') as string;
const SAFE_BOOT =
  RAW_SAFE_BOOT === '1' || RAW_SAFE_BOOT.toLowerCase?.() === 'true';

/* -------------------- navigation helpers -------------------- */
let getCurrentRouteSafe:
  | (() => { name?: string } | undefined)
  | null = null;
try {
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
  /* ignore */
}

function handleTapNavigation(data: any) {
  if (!data) return;
  try {
    const { navigate } = require('@navigation/RootNavigation');
    const t = data?.type as string | undefined;

    if (!t) {
      if (data?.date_id) {
        navigate('DateFeed', { scrollToDateId: data.date_id } as any);
      }
      return;
    }

    switch (t) {
      case 'INVITE_RECEIVED':
        navigate('MyInvites', {
          inviteId: data?.invite_id,
          dateId: data?.date_id,
        } as any);
        break;
      case 'INVITE_ACCEPTED':
        navigate('MyDates', {
          initialTab: 'Accepted',
          dateId: data?.date_id,
        } as any);
        break;
      case 'JOIN_REQUEST':
        navigate('MyDates', {
          focus: 'JoinRequests',
          requestId: data?.request_id,
          dateId: data?.date_id,
        } as any);
        break;
      default:
        if (data?.date_id) {
          navigate('DateFeed', { scrollToDateId: data.date_id } as any);
        }
        break;
    }
  } catch (e) {
    console.warn('[PushTap] navigation error:', (e as Error)?.message);
  }
}

/* -------------------- breadcrumb logger (optional) -------------------- */
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
          console.log('[Breadcrumb] route:', name);
        } catch {}
      }
    };

    InteractionManager.runAfterInteractions(() => {
      if (!cancelled) logIfChanged();
    });

    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') setTimeout(logIfChanged, 200);
    });

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

/* -------------------- main app -------------------- */
export default function App() {
  const listenersAttachedRef = useRef(false);

  // Capture invite deep links at boot (works for cold start + while running)
  useEffect(() => {
    const stop = initInviteDeepLinking();
    return () => {
      try {
        (stop as any)?.();
      } catch {}
    };
  }, []);

  // Unlock SafeEmitter shim after app becomes active & interactions flush
  useEffect(() => {
    let cancelled = false;
    const unlockWhenReady = async () => {
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

  // Supabase auth auto-refresh
  useEffect(() => {
    supabase.auth.startAutoRefresh?.();
    return () => {
      try {
        supabase.auth.stopAutoRefresh?.();
      } catch {}
    };
  }, []);

  // Optional: refresh-token rotation hook (safe if missing)
  useEffect(() => {
    /** @type {undefined | (() => void)} */
    let off;
    try {
      const { attachQuickUnlockRotationListener } = require('@services/QuickUnlockService');
      off = attachQuickUnlockRotationListener();
    } catch (e) {
      console.warn('[QuickUnlock] rotation listener not attached:', (e as Error)?.message);
    }
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, []);

  // --- Push: register once on startup (prod-safe, lazy imports) ---
  useEffect(() => {
    if (!PUSH_ALLOWED) return;

    let cancelled = false;
    (async () => {
      try {
        const { initNotificationsOnce } = await import('@services/NotificationService');
        if (!cancelled) await initNotificationsOnce();
      } catch (e) {
        console.warn('[Push] init failed:', (e as Error)?.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Push: attach listeners for foreground receipt & tap to open ---
  useEffect(() => {
    if (!PUSH_ALLOWED) return;

    let cancelled = false;
    let cleanups: Array<() => void> = [];

    const attach = async () => {
      // Wait for UI to settle — avoids iOS 18 edge cases
      await new Promise<void>((resolve) =>
        InteractionManager.runAfterInteractions(() => resolve())
      );
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Platform.OS === 'ios' ? 450 : 60)
      );
      if (cancelled || listenersAttachedRef.current) return;

      try {
        const Notifications = await import('expo-notifications');

        // Handle cold-start from a tap (if any)
        try {
          const last = await (Notifications as any).getLastNotificationResponseAsync?.();
          const data = last?.notification?.request?.content?.data;
          if (data) handleTapNavigation(data);
        } catch {}

        const receivedSub =
          Notifications.addNotificationReceivedListener?.(() => {}) as any;
        const tapSub =
          Notifications.addNotificationResponseReceivedListener?.((resp) => {
            const data = resp?.notification?.request?.content?.data;
            handleTapNavigation(data);
          }) as any;

        cleanups = [
          () => {
            try {
              receivedSub?.remove?.();
            } catch {}
          },
          () => {
            try {
              tapSub?.remove?.();
            } catch {}
          },
        ];

        listenersAttachedRef.current = true;
      } catch (e) {
        // If plugin is not present on iOS build, import will throw — safe to ignore
        console.warn('[Push] listeners not attached:', (e as Error)?.message);
      }
    };

    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') attach();
    });
    if (AppState.currentState === 'active') attach();

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
            <BreadcrumbLogger />
            {/* Toggle safe boot via EXPO_PUBLIC_SAFE_BOOT (defaults ON) */}
            {SAFE_BOOT ? <UltraSafeBoot /> : <AppNavigator />}
          </GlobalErrorBoundary>
        </AppBootGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
