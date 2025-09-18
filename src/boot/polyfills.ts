// src/boot/polyfills.ts
// Run as early as possible. Harmless if Platform already imported properly.

import { Platform } from 'react-native';

// Make Platform available on global for any legacy modules that use it
// without importing. Hermes doesn't expose a global Platform, so we shim it.
;(global as any).Platform = (global as any).Platform ?? Platform;

// (Optional) quiet noisy YellowBox message patterns here if needed
// import { LogBox } from 'react-native';
// LogBox.ignoreLogs(['useInsertionEffect must not schedule updates']);
