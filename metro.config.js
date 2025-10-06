// metro.config.js
const path = require('path');

let getDefaultConfig;
try {
  ({ getDefaultConfig } = require('expo/metro-config'));
} catch {
  ({ getDefaultConfig } = require('@react-native/metro-config'));
}

const config = getDefaultConfig(__dirname);

// Use real native Branch only when explicitly enabled
const useNativeBranch = !!process.env.USE_BRANCH_NATIVE;

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = config.resolver.extraNodeModules || {};

if (!useNativeBranch) {
  // In Expo Go, alias Branch to a no-op shim to avoid native crashes
  config.resolver.extraNodeModules['react-native-branch'] = path.resolve(
    __dirname,
    'src/shims/branch.js'
  );
}

module.exports = config;
