require('dotenv').config();

/** @type {import('@expo/config').ExpoConfig} */
const expoConfig = {
  name: 'DrYnksApp',
  slug: 'drynks-app',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/app_icon.png',
  entryPoint: './index.js',
  scheme: 'dr-ynks',
  userInterfaceStyle: 'automatic',

  splash: {
    image: './assets/images/drYnks_logo.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },

  assetBundlePatterns: ['**/*'],

  updates: {
    fallbackToCacheTimeout: 0,
    url: 'https://u.expo.dev/c3eeca28-9032-43dd-bef7-7697e473ccb2',
  },

  runtimeVersion: '1.0.0',

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.drynks.app',
    buildNumber: '2025091705',
    usesAppleSignIn: true,

    // Branch Associated Domains (Universal Links)
    associatedDomains: [
      'applinks:dr-ynks.app.link',
      'applinks:dr-ynks-alternate.app.link?mode=developer',
    ],

    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'This app uses your location to find nearby dates and events.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Allow location access to improve nearby matches and safety features.',
      NSCameraUsageDescription:
        'This app uses your camera to update your profile photo.',
      NSPhotoLibraryUsageDescription:
        'This app needs access to your photo gallery for uploading profile images.',
      NSPhotoLibraryAddUsageDescription:
        'This app saves photos you take during event creation.',
      NSMicrophoneUsageDescription:
        'Allow microphone access for voice messages and videos.',
      NSMotionUsageDescription:
        'Motion data may be used to enhance in-app experiences.',
      NSBluetoothAlwaysUsageDescription:
        'Bluetooth may be used to discover and connect to nearby devices.',
      NSUserTrackingUsageDescription:
        'We use your device identifier to improve recommendations and app experience.',
      NSFaceIDUsageDescription:
        'Allow Face ID to quickly unlock your account.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    // ⚠️ Keep "com.drynks.dev" if that’s your Play Console package.
    // If you want to unify with iOS ("com.drynks.app"), update Play + Branch dashboard too.
    package: 'com.drynks.dev',
    versionCode: 2,

    adaptiveIcon: {
      foregroundImage: './assets/images/app_icon.png',
      backgroundColor: '#ffffff',
    },

    permissions: [
      'CAMERA',
      'READ_EXTERNAL_STORAGE',
      'ACCESS_MEDIA_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'USE_BIOMETRIC',
      'USE_FINGERPRINT',
      'RECORD_AUDIO',
    ],

    // Deep link filters (Branch + fallback scheme)
    intentFilters: [
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'dr-ynks' }],
      },
      {
        autoVerify: true,
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'dr-ynks.app.link', pathPrefix: '/' }],
      },
      {
        autoVerify: true,
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'dr-ynks-alternate.app.link', pathPrefix: '/' }],
      },
    ],
  },

  web: { favicon: './assets/images/app_icon.png' },

  extra: {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    EXPO_PUBLIC_GOOGLE_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_API_KEY,
    EXPO_PUBLIC_DISABLE_PUSH: process.env.EXPO_PUBLIC_DISABLE_PUSH ?? '0',
    EXPO_PUBLIC_DISABLE_BIOMETRICS: process.env.EXPO_PUBLIC_DISABLE_BIOMETRICS ?? '0',
    EXPO_PUBLIC_SAFE_BOOT: process.env.EXPO_PUBLIC_SAFE_BOOT ?? '1',
    BRANCH_DOMAIN: 'dr-ynks.app.link',
    eas: { projectId: 'c3eeca28-9032-43dd-bef7-7697e473ccb2' },
  },

  owner: 'drynks15',
  projectId: 'c3eeca28-9032-43dd-bef7-7697e473ccb2',

  plugins: [
    'expo-splash-screen',
    'expo-secure-store',
    'expo-image-picker',
    'expo-location',
    'expo-apple-authentication',
    [
      'expo-build-properties',
      { ios: { useFrameworks: 'static', deploymentTarget: '17.0' } },
    ],
    'expo-notifications',

    // Local Branch config plugin (injects keys into native)
    [
      './plugins/with-branch',
      {
        liveKey: process.env.BRANCH_KEY_LIVE,
        testKey: process.env.BRANCH_KEY_TEST,
        domains: ['dr-ynks.app.link', 'dr-ynks-alternate.app.link'],
      },
    ],
  ],
};

module.exports = { expo: expoConfig };
