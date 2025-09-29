// app.config.js
// ------------------------------------------------------------
// DrYnksApp – Expo config (production-ready)
// ------------------------------------------------------------
require('dotenv').config();

/** Normalize yes/true/1 to boolean true. */
const parseBool = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

const USE_EXPO_GO =
  parseBool(process.env.EXPO_PUBLIC_USE_EXPO_GO) ||
  process.env.EXPO_TARGET === 'expo';

const DISABLE_BRANCH =
  USE_EXPO_GO || parseBool(process.env.EXPO_PUBLIC_DISABLE_BRANCH);

const USE_BRANCH_TEST = parseBool(process.env.BRANCH_USE_TEST);

// Shared Branch domains (live + test, including '-alternate')
const BRANCH_DOMAINS = [
  'dr-ynks.app.link',
  'dr-ynks-alternate.app.link',
  'dr-ynks.test-app.link',
  'dr-ynks-alternate.test-app.link',
];

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

  updates: USE_EXPO_GO
    ? { enabled: false }
    : { url: 'https://u.expo.dev/c3eeca28-9032-43dd-bef7-7697e473ccb2' },

  // Keep SDK pinned for Expo Go compatibility; EAS Dev Client also respects this.
  sdkVersion: '54.0.0',

  // Use appVersion for runtime versioning (works with expo-updates).
  ...(USE_EXPO_GO ? {} : { runtimeVersion: { policy: 'appVersion' } }),

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.drynks.app',
    buildNumber: '2025091715',
    usesAppleSignIn: true,

    // Keep these in config (plugin also adds them; duplicates are de-duped).
    associatedDomains: BRANCH_DOMAINS.map((d) => `applinks:${d}`),

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
    package: 'com.drynks.dev', // keep as-is unless you want to ship prod under com.drynks.app
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
    intentFilters: [
      // Custom scheme
      { action: 'VIEW', category: ['BROWSABLE', 'DEFAULT'], data: [{ scheme: 'dr-ynks' }] },

      // Branch App Links (LIVE + ALTERNATE)
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

      // Branch App Links (TEST + ALTERNATE TEST)
      {
        autoVerify: true,
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'dr-ynks.test-app.link', pathPrefix: '/' }],
      },
      {
        autoVerify: true,
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'dr-ynks-alternate.test-app.link', pathPrefix: '/' }],
      },
    ],
  },

  web: { favicon: './assets/images/app_icon.png' },

  extra: {
    // Backend + API keys
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    EXPO_PUBLIC_GOOGLE_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_API_KEY,

    // Feature toggles
    EXPO_PUBLIC_DISABLE_PUSH: process.env.EXPO_PUBLIC_DISABLE_PUSH ?? '0',
    EXPO_PUBLIC_DISABLE_BIOMETRICS: process.env.EXPO_PUBLIC_DISABLE_BIOMETRICS ?? '0',
    EXPO_PUBLIC_SAFE_BOOT: process.env.EXPO_PUBLIC_SAFE_BOOT ?? '1',

    // Linking + env flags
    EXPO_PUBLIC_USE_EXPO_GO: USE_EXPO_GO ? '1' : '0',
    EXPO_PUBLIC_DISABLE_BRANCH: DISABLE_BRANCH ? '1' : '0',
    EXPO_PUBLIC_SCHEME: process.env.EXPO_PUBLIC_SCHEME || 'dr-ynks',
    EXPO_PUBLIC_LINK_HOST: process.env.EXPO_PUBLIC_LINK_HOST || 'dr-ynks.app.link',
    EXPO_PUBLIC_MARKETING_URL: process.env.EXPO_PUBLIC_MARKETING_URL || '',

    // Branch
    BRANCH_DOMAIN: 'dr-ynks.app.link',
    BRANCH_USE_TEST: USE_BRANCH_TEST ? '1' : '0',

    // EAS project
    eas: { projectId: 'c3eeca28-9032-43dd-bef7-7697e473ccb2' },
  },

  owner: 'drynks15',
  projectId: 'c3eeca28-9032-43dd-bef7-7697e473ccb2',

  plugins: [
    'expo-font',
    'expo-splash-screen',
    'expo-secure-store',
    'expo-image-picker',
    'expo-location',
    'expo-apple-authentication',
    'expo-notifications',

    // (Optional) Static frameworks + iOS deployment target
    ...(USE_EXPO_GO
      ? []
      : [['expo-build-properties', { ios: { useFrameworks: 'static', deploymentTarget: '15.1' } }]]),

    // Local Branch plugin (disabled in Expo Go or if explicitly disabled)
    ...(!DISABLE_BRANCH
      ? [[
          './plugins/with-branch.js',
          {
            liveKey: process.env.BRANCH_KEY_LIVE,
            testKey: process.env.BRANCH_KEY_TEST,
            useTestInstance: USE_BRANCH_TEST,
            domains: BRANCH_DOMAINS,
          },
        ]]
      : []),
  ],
};

module.exports = expoConfig;
