// metro.config.js at project root
let getDefaultConfig;

try {
  // If you have Expo (you do), use Expo's Metro config:
  ({ getDefaultConfig } = require('expo/metro-config'));
} catch {
  // Fallback to React Native's config in case Expo isn't available
  ({ getDefaultConfig } = require('@react-native/metro-config'));
}

module.exports = getDefaultConfig(__dirname);
