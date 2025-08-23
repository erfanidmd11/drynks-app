// app.config.ts
import 'dotenv/config';

const ASSOCIATED_DOMAINS = [
  // Branch + Firebase Dynamic Links
  'applinks:dr-ynks.app.link',
  'applinks:dr-ynks.page.link',
] as const;

export default {
  expo: {
    name: 'DrYnksApp',
    slug: 'drynks-app',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/app_icon.png',

    // Make sure our guard runs first
    entryPoint: './index.js',

    // Deep linking scheme
    scheme: 'dr-ynks',
    userInterfaceStyle: 'automatic',

    splash: {
      image: './assets/images/drYnks_logo.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },

    assetBundlePatterns: ['**/*'],

    updates: { fallbackToCacheTimeout: 0 },
    runtimeVersion: '1.0.0',

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.drynks.app',
      buildNumber: '2025081457', // bump for resubmission
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

      // Required for Branch/Firebase Dynamic Links
      associatedDomains: [...ASSOCIATED_DOMAINS],
      // ⛔️ Do NOT declare manual entitlements here.
      // Let EAS sync capabilities (push, Sign in with Apple, etc.) when needed.
    },

    android: {
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
          data: [{ scheme: 'https', host: 'dr-ynks.app.link' }],
        },
        {
          autoVerify: true,
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'https', host: 'dr-ynks.page.link' }],
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

      // Kill switches (read by app + services)
      EXPO_PUBLIC_DISABLE_PUSH: '1', // push disabled for this build
      EXPO_PUBLIC_DISABLE_BIOMETRICS: '1',

      // Safe boot toggle (defaults ON). Set to '0' to render AppNavigator directly.
      EXPO_PUBLIC_SAFE_BOOT: process.env.EXPO_PUBLIC_SAFE_BOOT ?? '1',

      eas: { projectId: 'c3eeca28-9032-43dd-bef7-7697e473ccb2' },
    },

    owner: 'drynks15',
    projectId: 'c3eeca28-9032-43dd-bef7-7697e473ccb2',

    plugins: [
      'expo-splash-screen',
      'expo-secure-store',
      'expo-image-picker',
      'expo-location',
      [
        'expo-build-properties',
        {
          ios: {
            useFrameworks: 'static',
            deploymentTarget: '17.0',
          },
        },
      ],
      // When you actually use these features, add the plugins and rebuild:
      // 'expo-apple-authentication',  // enables Sign in with Apple entitlements
      // 'expo-notifications',         // enables push (aps-environment)
    ],
  },
} as const;
