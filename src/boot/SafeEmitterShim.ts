// src/boot/SafeEmitterShim.ts
// Harden NativeEventEmitter for iOS 18: ignore non-emitters + block early adds until UI is ready.

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

const OriginalNEE = (RN as any).NativeEventEmitter as any;

function getModuleName(nativeModule: any) {
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

class SafeNativeEventEmitter extends OriginalNEE {
  private __nativeModule: any;

  constructor(nativeModule?: any) {
    const hasAdd = typeof nativeModule?.addListener === 'function';
    const hasRemove = typeof nativeModule?.removeListeners === 'function';
    const isEmitter = !!nativeModule && hasAdd && hasRemove; // <-- AND, not OR

    // Only pass a module to the base class if it’s a *real* emitter
    super(isEmitter ? nativeModule : undefined);
    this.__nativeModule = isEmitter ? nativeModule : null;

    if (!isEmitter && nativeModule) {
      const name = getModuleName(nativeModule);
      try {
        console.warn(
          `[SafeEmitterShim] Suppressed NativeEventEmitter for non-emitter: ${name}`
        );
      } catch {}
    }
  }

  addListener(eventType: string, listener: AnyFn, context?: any) {
    // Cold-start guard for iOS 18
    if (Platform.OS === 'ios' && !EMITTERS_UNLOCKED) {
      if (LOGGED < MAX_LOG) {
        try {
          const name = this.__nativeModule
            ? getModuleName(this.__nativeModule)
            : 'UnknownNativeModule';
          console.warn(
            `[SafeEmitterShim] blocked addListener(${String(eventType)}) on ${name} during cold-start`
          );
        } catch {}
        LOGGED++;
      }
      return { remove() {} } as any;
    }

    // Non-emitter: swallow and return a disposable stub
    if (!this.__nativeModule) {
      return { remove() {} } as any;
    }

    return super.addListener(eventType, listener, context);
  }
}

// Patch the RN export before anything else imports it
(RN as any).NativeEventEmitter = SafeNativeEventEmitter;
