// index.js — tiny shim; safe to use in a TS project
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import { decode as atob, encode as btoa } from 'base-64';
if (!global.atob) global.atob = atob;
if (!global.btoa) global.btoa = btoa;

import './src/boot/SafeEmitterShim'; // crash guard must run first

import App from './App';
import { registerRootComponent } from 'expo';
registerRootComponent(App);
