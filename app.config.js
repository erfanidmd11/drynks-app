export default {
  expo: {
    name: "DrYnks",
    slug: "drynks-app",
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
    runtimeVersion: {
      policy: "appVersion"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.drynks.app",
      buildNumber: "1.3.8",
      infoPlist: {
        NSLocationWhenInUseUsageDescription: "This app uses your location to find nearby dates and events.",
        NSCameraUsageDescription: "This app uses your camera to update your profile photo.",
        NSPhotoLibraryUsageDescription: "This app needs access to your photos for uploading your gallery.",
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      package: "com.drynks.app",
      versionCode: 2,
      adaptiveIcon: {
        foregroundImage: "./assets/images/app_icon.png",
        backgroundColor: "#ffffff"
      },
      permissions: [
        "ACCESS_FINE_LOCATION",
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE"
      ]
    },
    web: {
      favicon: "./assets/images/app_icon.png"
    },
    extra: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      eas: {
        projectId: "590cfbfa-9c6b-4a56-942d-d2b66609e98d" // ✅ Linked to drynks1
      }
    },
    owner: "drynks1",
    plugins: ["expo-secure-store"]
  }
};

