import 'dotenv/config';

export default {
  expo: {
    name: "DrYnks",
    slug: "drynks8",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/app_icon.png",
    scheme: "drynks",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/images/drYnks_logo.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    assetBundlePatterns: ["**/*"],
    jsEngine: "jsc",
    updates: {
      fallbackToCacheTimeout: 0
    },
    runtimeVersion: "1.0.0",

    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.drynks.dev",
      buildNumber: "2025072313",
      infoPlist: {
        NSLocationWhenInUseUsageDescription: "This app uses your location to find nearby dates and events.",
        NSCameraUsageDescription: "This app uses your camera to update your profile photo.",
        NSPhotoLibraryUsageDescription: "This app needs access to your photo gallery for uploading profile images.",
        NSPhotoLibraryAddUsageDescription: "This app saves photos you take during event creation.",
        ITSAppUsesNonExemptEncryption: false
      }
    },

    android: {
      package: "com.drynks.dev",
      versionCode: 2,
      adaptiveIcon: {
        foregroundImage: "./assets/images/app_icon.png",
        backgroundColor: "#ffffff"
      },
      permissions: [
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "ACCESS_MEDIA_LOCATION",
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION"
      ],
      useNextNotificationsApi: true
    },

    web: {
      favicon: "./assets/images/app_icon.png"
    },

    extra: {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  eas: {
   projectId: "5131196d-be4e-40b4-a328-cb6f1f6381ff"
  }
},
owner: "drynks8",


    plugins: [
      "expo-secure-store",
      "expo-notifications",
      "expo-image-picker",
      "expo-location"
    ]
  }
};

