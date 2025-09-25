// Prevent older libs from crashing RN 0.74+ by reassigning NativeEventEmitter.
// RN 0.74+ exposes it as a getter-only property; some libs still try to write to it.
// We keep the existing getter and add a no-op setter to swallow illegal writes.
try {
  const RN = require('react-native');
  const desc = Object.getOwnPropertyDescriptor(RN, 'NativeEventEmitter');
  if (desc && typeof desc.get === 'function' && !desc.set) {
    Object.defineProperty(RN, 'NativeEventEmitter', {
      configurable: true,
      enumerable: true,
      get: desc.get,
      set() {
        // no-op: swallow illegal writes performed by legacy libraries
      },
    });
  }
} catch {
  // If anything goes wrong, do nothing; this is a soft guard.
}
