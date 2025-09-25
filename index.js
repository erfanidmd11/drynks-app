// index.js — single entry for Expo Go + dev client

// MUST be first
import 'react-native-gesture-handler';
// MUST be before anything that uses Reanimated (layouts/worklets)
import 'react-native-reanimated';

import { registerRootComponent } from 'expo';

// Optional polyfills AFTER Reanimated
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

// atob/btoa polyfills (some libs need these)
import { decode as atob, encode as btoa } from 'base-64';
if (!globalThis.atob) globalThis.atob = atob;
if (!globalThis.btoa) globalThis.btoa = btoa;

// If you have Buffer usage elsewhere, uncomment:
// globalThis.Buffer = globalThis.Buffer || require('buffer').Buffer;

// Keep shims AFTER Reanimated too
import './src/boot/SafeEmitterShim';

import App from './App';

// ✅ This registers the "main" component correctly for Expo
registerRootComponent(App);
