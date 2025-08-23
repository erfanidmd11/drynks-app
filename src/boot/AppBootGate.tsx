// src/boot/SafeEmitterShim.ts
// Prevent iOS 18 TurboModule aborts when addListener/removeListeners are
// called on a non-emitter module. Logs the module so we can fix the source.

import * as RN from 'react-native';

const OriginalNEE = RN.NativeEventEmitter as any;

class SafeNativeEventEmitter extends OriginalNEE {
  private __nativeModule: any;

  constructor(nativeModule?: any) {
    const isEmitter =
      !!nativeModule &&
      (typeof nativeModule.addListener === 'function' ||
       typeof nativeModule.removeListeners === 'function');

    super(isEmitter ? nativeModule : undefined);
    this.__nativeModule = isEmitter ? nativeModule : null;

    if (!isEmitter && nativeModule) {
      try {
        const name =
          nativeModule?.name ??
          nativeModule?.getName?.() ??
          nativeModule?.getConstants?.()?.name ??
          'UnknownNativeModule';
        console.warn(`[SafeEmitterShim] Suppressed NativeEventEmitter for non-emitter: ${name}`);
      } catch {
        console.warn('[SafeEmitterShim] Suppressed NativeEventEmitter for non-emitter (unknown name)');
      }
    }
  }

  addListener(eventType: string, listener: (...args: any[]) => any, context?: any) {
    if (!this.__nativeModule || typeof this.__nativeModule.addListener !== 'function') {
      return { remove: () => {} } as any;
    }
    return super.addListener(eventType, listener, context);
  }

  removeAllListeners(eventType: string) {
    if (!this.__nativeModule || typeof this.__nativeModule.removeListeners !== 'function') {
      return;
    }
    return super.removeAllListeners(eventType);
  }
}

(RN as any).NativeEventEmitter = SafeNativeEventEmitter;
