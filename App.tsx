// App.tsx — RN 0.81 / Expo SDK 54/55 boot with Reanimated v3 and iOS18 safety

// 1) MUST BE FIRST (before any other import that touches React Native)
import 'react-native-gesture-handler';

// 2) Reanimated must load very early so worklets/host functions are ready
import 'react-native-reanimated';

// 3) iOS18 & legacy libs guard (loads after core RN, still early)
// ❌ removed: import './src/shims/fixNativeEventEmitterAssign';
import './src/boot/SafeEmitterShim';
import { unlockEmitters } from './src/boot/SafeEmitterShim';
import { ensureValidSupabaseSessionOnce } from './src/boot/ensureValidSupabaseSession';

// 4) Polyfills (before any network/crypto usage)
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import './src/boot/polyfills';
import { decode as atobPolyfill, encode as btoaPolyfill } from 'base-64';
if (typeof (globalThis as any).atob === 'undefined') (globalThis as any).atob = atobPolyfill;
if (typeof (globalThis as any).btoa === 'undefined') (globalThis as any).btoa = btoaPolyfill;

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
import { enableScreens } from 'react-native-screens';
import Constants from 'expo-constants';

import AppNavigator from './src/navigation/AppNavigator';
import AppBootGate from './src/boot/AppBootGate';
import GlobalErrorBoundary from './src/boot/GlobalErrorBoundary';
import UltraSafeBoot from './src/boot/UltraSafeBoot';
import { supabase } from '@config/supabase';
import { initInviteDeepLinking } from '@services/InviteLinks';

// Prefer native screen primitives (RN 0.81 compatible)
enableScreens(true);

// Quiet common noisy logs
LogBox.ignoreLogs(['Setting a timer']);

/* -------------------- env flags -------------------- */
const RAW_PUSH_FLAG =
  (process?.env?.EXPO_PUBLIC_DISABLE_PUSH ??
    (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_DISABLE_PUSH ??
    '0') as string;
const PUSH_DISABLED =
  RAW_PUSH_FLAG === '1' || RAW_PUSH_FLAG.toLowerCase?.() === 'true';
const PUSH_ALLOWED = !PUSH_DISABLED;

const RAW_SAFE_BOOT =
  (process?.env?.EXPO_PUBLIC_SAFE_BOOT ??
    (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_SAFE_BOOT ??
    '1') as string;
const SAFE_BOOT =
  RAW_SAFE_BOOT === '1' || RAW_SAFE_BOOT.toLowerCase?.() === 'true';

/* -------------------- optional route breadcrumbs -------------------- */
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
      if (data?.date_id) navigate('DateFeed', { scrollToDateId: data.date_id } as any);
      return;
    }

    switch (t) {
      case 'INVITE_RECEIVED':
        navigate('MyInvites', { inviteId: data?.invite_id, dateId: data?.date_id } as any);
        break;
      case 'INVITE_ACCEPTED':
        navigate('MyDates', { initialTab: 'Accepted', dateId: data?.date_id } as any);
        break;
      case 'JOIN_REQUEST':
        navigate('MyDates', {
          focus: 'JoinRequests',
          requestId: data?.request_id,
          dateId: data?.date_id,
        } as any);
        break;
      default:
        if (data?.date_id) navigate('DateFeed', { scrollToDateId: data.date_id } as any);
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

  // ✅ Unlock the SafeEmitter shim after the first frame (fixes iOS 18 cold‑start emitter issues)
  useEffect(() => {
    const id = requestAnimationFrame(() => unlockEmitters());
    return () => cancelAnimationFrame(id);
  }, []);

  // Validate session once at boot (prevents stale refresh-token error spam)
  useEffect(() => {
    void ensureValidSupabaseSessionOnce();
  }, []);

  // Deep links for invites (cold + warm)
  useEffect(() => {
    const stop = initInviteDeepLinking();
    return () => {
      try {
        (stop as any)?.();
      } catch {}
    };
  }, []);

  // Supabase token auto-refresh lifecycle
  useEffect(() => {
    supabase.auth.startAutoRefresh?.();
    return () => {
      try {
        supabase.auth.stopAutoRefresh?.();
      } catch {}
    };
  }, []);

  // Optional: quick-unlock rotation hook if present
  useEffect(() => {
    let off: undefined | (() => void);
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

  // Push: lazy‑init and listeners (safe on devices without the native module)
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

  useEffect(() => {
    if (!PUSH_ALLOWED) return;

    let cancelled = false;
    let cleanups: Array<() => void> = [];

    const attach = async () => {
      await new Promise<void>((resolve) =>
        InteractionManager.runAfterInteractions(() => resolve())
      );
      await new Promise<void>((r) => setTimeout(r, Platform.OS === 'ios' ? 450 : 60));
      if (cancelled || listenersAttachedRef.current) return;

      try {
        const Notifications = await import('expo-notifications');

        // Handle cold start tap if any
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
            {SAFE_BOOT ? <UltraSafeBoot /> : <AppNavigator />}
          </GlobalErrorBoundary>
        </AppBootGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
