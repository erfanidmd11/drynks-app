// src/navigation/RootNavigation.ts
import {
  CommonActions,
  StackActions,
  createNavigationContainerRef,
} from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation'; // ← fixed path

// Strongly-typed ref bound to your app's route map
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Queue any nav actions that occur before the container is ready
type NavAction = () => void;
const pending: NavAction[] = [];

function flushPending() {
  if (!navigationRef.isReady()) return;
  while (pending.length) {
    const action = pending.shift();
    try {
      action?.();
    } catch (e) {
      console.warn('[Nav] queued action failed:', (e as Error)?.message);
    }
  }
}

/** Call this from <NavigationContainer onReady={onNavigationReady} /> */
export function onNavigationReady() {
  flushPending();
}

/** Safely run a nav action now or queue it for when the ref becomes ready. */
function run(action: NavAction) {
  if (navigationRef.isReady()) {
    action();
  } else {
    pending.push(action);
  }
}

/** Navigate to a route by name, with typed params. */
export function navigate<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name]
) {
  run(() => {
    try {
      navigationRef.dispatch(
        CommonActions.navigate({
          name: name as string,
          // Cast to any to satisfy CommonActions param shape when undefined
          params: params as any,
        })
      );
    } catch (e) {
      console.warn('[Nav] navigate error:', (e as Error)?.message);
    }
  });
}

/** Push a new route onto the stack (StackActions.push). */
export function push<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name]
) {
  run(() => {
    try {
      navigationRef.dispatch(StackActions.push(name as string, params as any));
    } catch (e) {
      console.warn('[Nav] push error:', (e as Error)?.message);
    }
  });
}

/** Replace the current route (StackActions.replace). */
export function replace<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name]
) {
  run(() => {
    try {
      navigationRef.dispatch(StackActions.replace(name as string, params as any));
    } catch (e) {
      console.warn('[Nav] replace error:', (e as Error)?.message);
    }
  });
}

/** Go back if possible (no-op if not). */
export function goBack() {
  run(() => {
    try {
      if (navigationRef.canGoBack()) {
        navigationRef.goBack();
      }
    } catch (e) {
      console.warn('[Nav] goBack error:', (e as Error)?.message);
    }
  });
}

/** Reset the navigation state to a new root (e.g., after logout). */
export function resetTo<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name]
) {
  run(() => {
    try {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: name as string, params: params as any }],
        })
      );
    } catch (e) {
      console.warn('[Nav] resetTo error:', (e as Error)?.message);
    }
  });
}

/** Get the current route name (if available). */
export function getCurrentRouteName(): keyof RootStackParamList | undefined {
  try {
    if (navigationRef.isReady()) {
      return navigationRef.getCurrentRoute()?.name as keyof RootStackParamList | undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Get the current route params (typed, if known). */
export function getCurrentParams<T = unknown>(): T | undefined {
  try {
    if (navigationRef.isReady()) {
      return navigationRef.getCurrentRoute()?.params as T | undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}
