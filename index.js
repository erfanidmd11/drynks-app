// index.js
import 'react-native-gesture-handler';
import 'react-native-reanimated';

import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import { decode as atob, encode as btoa } from 'base-64';
if (!global.atob) global.atob = atob;
if (!global.btoa) global.btoa = btoa;

import './src/boot/SafeEmitterShim';

import { AppRegistry } from 'react-native';
import App from './App';
AppRegistry.registerComponent('DrYnksApp', () => App);
