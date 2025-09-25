// app.config.js
require('dotenv').config();

/**
 * Toggle "Expo Go" mode with EXPO_PUBLIC_USE_EXPO_GO=1
 * - Disables custom Branch plugin + custom runtime so Expo Go can load the project.
 * - Leaves everything else production-ready by default.
 */
const USE_EXPO_GO =
  process.env.EXPO_PUBLIC_USE_EXPO_GO === '1' ||
  process.env.EXPO_TARGET === 'expo';

const DISABLE_BRANCH =
  USE_EXPO_GO || process.env.EXPO_PUBLIC_DISABLE_BRANCH === '1';

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

  // EAS Updates
  // In Expo Go we turn updates off to avoid "custom runtime" targeting issues.
  // In dev client / production we use the configured EAS Updates channel.
  updates: USE_EXPO_GO
    ? { enabled: false }
    : {
        url: 'https://u.expo.dev/c3eeca28-9032-43dd-bef7-7697e473ccb2',
      },

  // Custom runtime is only needed for dev-client / production builds.
  // Expo Go uses SDK targeting via sdkVersion.
  ...(USE_EXPO_GO ? {} : { runtimeVersion: { policy: 'appVersion' } }),
  sdkVersion: '54.0.0',

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.drynks.app',
    buildNumber: '2025091714',
    usesAppleSignIn: true,

    // Associated Domains needed for Branch deep links (has no effect in Expo Go).
    associatedDomains: [
      'applinks:dr-ynks.app.link',
      'applinks:dr-ynks-alternate.app.link',
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
    package: 'com.drynks.dev', // adjust for production release when ready
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
    // Server/client config
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,

    // Maps/Places
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    EXPO_PUBLIC_GOOGLE_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_API_KEY,

    // Feature flags
    EXPO_PUBLIC_DISABLE_PUSH: process.env.EXPO_PUBLIC_DISABLE_PUSH ?? '0',
    EXPO_PUBLIC_DISABLE_BIOMETRICS: process.env.EXPO_PUBLIC_DISABLE_BIOMETRICS ?? '0',
    EXPO_PUBLIC_SAFE_BOOT: process.env.EXPO_PUBLIC_SAFE_BOOT ?? '1',

    // Deep link + Branch flags (read by your app code)
    EXPO_PUBLIC_USE_EXPO_GO: USE_EXPO_GO ? '1' : '0',
    EXPO_PUBLIC_DISABLE_BRANCH: DISABLE_BRANCH ? '1' : '0',
    BRANCH_DOMAIN: 'dr-ynks.app.link',

    // Your scheme/host (also in env.ts)
    EXPO_PUBLIC_SCHEME: process.env.EXPO_PUBLIC_SCHEME || 'dr-ynks',
    EXPO_PUBLIC_LINK_HOST: process.env.EXPO_PUBLIC_LINK_HOST || 'dr-ynks.app.link',
    EXPO_PUBLIC_MARKETING_URL: process.env.EXPO_PUBLIC_MARKETING_URL || '',

    // EAS
    eas: { projectId: 'c3eeca28-9032-43dd-bef7-7697e473ccb2' },
  },

  owner: 'drynks15',
  projectId: 'c3eeca28-9032-43dd-bef7-7697e473ccb2',

  /**
   * Plugins:
   * - Keep only Expo Go–compatible plugins when USE_EXPO_GO is true.
   * - Re-enable Branch + build properties automatically when USE_EXPO_GO is false
   *   (dev client / production).
   */
  plugins: [
    'expo-font',
    'expo-splash-screen',
    'expo-secure-store',
    'expo-image-picker',
    'expo-location',
    'expo-apple-authentication',
    'expo-notifications',

    // Only apply native build tweaks when NOT running in Expo Go
    ...(USE_EXPO_GO
      ? []
      : [
          [
            'expo-build-properties',
            { ios: { useFrameworks: 'static', deploymentTarget: '15.1' } },
          ],
        ]),

    // Custom Branch plugin (disabled in Expo Go)
    ...(!DISABLE_BRANCH
      ? [
          [
            './plugins/with-branch',
            {
              liveKey: process.env.BRANCH_KEY_LIVE,
              testKey: process.env.BRANCH_KEY_TEST,
              domains: ['dr-ynks.app.link', 'dr-ynks-alternate.app.link'],
            },
          ],
        ]
      : []),
  ],
};

module.exports = { expo: expoConfig };
