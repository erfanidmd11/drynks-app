/**
 * SafeEmitterShim (RN 0.81+ / iOS 18) — production ready
 *
 * - Never assign to React Native's `NativeEventEmitter` export (getter-only on iOS 18).
 * - Patch the class prototype to harden `addListener`.
 * - Provide an optional legacy alias for `RCTDeviceEventEmitter`.
 *
 * Import very early (after Reanimated) in index.js:
 *   import './src/boot/SafeEmitterShim';
 */

import * as RN from 'react-native';
import { Platform } from 'react-native';

type AnyFn = (...args: any[]) => any;

let EMITTERS_UNLOCKED = false;
let LOGGED = 0;
const MAX_LOG = 30;

export function unlockEmitters() {
  EMITTERS_UNLOCKED = true;
  try { console.log('[SafeEmitterShim] emitters UNLOCKED'); } catch {}
}

const resolveNEEClass = (): any => {
  const fromRN = (RN as any).NativeEventEmitter; // read-only getter on iOS 18
  if (fromRN) return fromRN;
  try {
    // Fallback for unusual packagers; safe to require
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native/Libraries/EventEmitter/NativeEventEmitter');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
};

const NativeEventEmitterClass: any = resolveNEEClass();

function getName(nativeModule: any) {
  try {
    return (
      nativeModule?.name ??
      nativeModule?.getName?.() ??
      nativeModule?.getConstants?.()?.name ??
      nativeModule?.constructor?.name ??
      'UnknownNativeModule'
    );
  } catch {
    return 'UnknownNativeModule';
  }
}

function isRealEmitter(nativeModule: any) {
  return (
    !!nativeModule &&
    typeof nativeModule.addListener === 'function' &&
    typeof nativeModule.removeListeners === 'function'
  );
}

// --------- Harden addListener without touching RN export itself ----------
(() => {
  const proto = NativeEventEmitterClass?.prototype;
  if (!proto) return;

  if ((proto as any).__dr_shimmed_addListener) return;
  Object.defineProperty(proto, '__dr_shimmed_addListener', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  const originalAdd: AnyFn = proto.addListener;

  proto.addListener = function addListenerPatched(
    eventType: string,
    listener: AnyFn,
    context?: any
  ) {
    const nativeModule = (this as any)?._nativeModule;

    // Gate early listeners on iOS 18 cold‑start until UI is mounted
    if (Platform.OS === 'ios' && !EMITTERS_UNLOCKED) {
      if (LOGGED < MAX_LOG) {
        try {
          console.warn(
            `[SafeEmitterShim] blocked addListener(${String(
              eventType
            )}) on ${getName(nativeModule)} during cold-start`
          );
        } catch {}
        LOGGED++;
      }
      return { remove() {} } as any;
    }

    if (!isRealEmitter(nativeModule)) {
      if (nativeModule) {
        try {
          console.warn(
            `[SafeEmitterShim] Suppressed addListener on non-emitter: ${getName(nativeModule)}`
          );
        } catch {}
      }
      return { remove() {} } as any;
    }

    return originalAdd.call(this, eventType, listener, context);
  };
})();

// --------- Optional legacy global alias (safe) ----------------------------
try {
  const G: any = globalThis as any;
  if (typeof G.RCTDeviceEventEmitter === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RCTDeviceEventEmitter } = require(
      'react-native/Libraries/EventEmitter/RCTDeviceEventEmitter'
    );
    Object.defineProperty(G, 'RCTDeviceEventEmitter', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: RCTDeviceEventEmitter,
    });
  }
} catch {}
