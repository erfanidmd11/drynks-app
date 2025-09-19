import 'dotenv/config';
import type { ExpoConfig } from '@expo/config';

const ASSOCIATED_DOMAINS = [
  'applinks:dr-ynks.app.link',
  // Developer/test Branch domain (replaces dr-ynks.page.link)
  'applinks:dr-ynks-alternate.app.link?mode=developer',
];

const PROJECT_ID = 'c3eeca28-9032-43dd-bef7-7697e473ccb2';

const config: ExpoConfig = {
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
    url: `https://u.expo.dev/${PROJECT_ID}`,
  },
  runtimeVersion: '1.0.0',

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.drynks.app',
    buildNumber: '2025091704',
    usesAppleSignIn: true,
    associatedDomains: [...ASSOCIATED_DOMAINS],
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
    package: 'com.drynks.dev',               // keep current package
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
      // Custom URI scheme fallback
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'dr-ynks' }],
      },
      // Branch primary domain
      {
        autoVerify: true,
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'dr-ynks.app.link', pathPrefix: '/' }],
      },
      // Branch dev/testing domain (replaces dr-ynks.page.link)
      {
        autoVerify: true,
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'dr-ynks-alternate.app.link', pathPrefix: '/' }],
      },
    ],
  },

  web: {
    favicon: './assets/images/app_icon.png',
  },

  extra: {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    EXPO_PUBLIC_GOOGLE_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_API_KEY,
    EXPO_PUBLIC_DISABLE_PUSH: process.env.EXPO_PUBLIC_DISABLE_PUSH ?? '0',
    EXPO_PUBLIC_DISABLE_BIOMETRICS: process.env.EXPO_PUBLIC_DISABLE_BIOMETRICS ?? '0',
    EXPO_PUBLIC_SAFE_BOOT: process.env.EXPO_PUBLIC_SAFE_BOOT ?? '1',
    eas: { projectId: PROJECT_ID },
    BRANCH_DOMAIN: 'dr-ynks.app.link',
  },

  owner: 'drynks15',
  projectId: PROJECT_ID,

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

    // ★ Branch config plugin (reads keys from EAS secrets)
    [
      'react-native-branch',
      {
        branchKey: process.env.BRANCH_KEY_LIVE,
        branchKeyTest: process.env.BRANCH_KEY_TEST,
      },
    ],
  ],
};

export default {
  expo: config,
} as const;
