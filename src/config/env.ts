// src/config/env.ts
import Constants from 'expo-constants';

/**
 * Read "extra" from the Expo manifest in production (EAS/OTA) and dev.
 * Fall back to process.env only as a last resort.
 */
const extra: Record<string, any> =
  // Dev client / Expo Go (SDK 49+)
  ((Constants as any)?.expoConfig?.extra as any) ??
  // Older SDKs / web
  ((Constants as any)?.manifest?.extra as any) ??
  {};

export const GOOGLE_PLACES_KEY: string =
  extra.EXPO_PUBLIC_GOOGLE_API_KEY ||
  extra.GOOGLE_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  '';

export const PLACES_COUNTRIES: string[] = String(
  extra.EXPO_PUBLIC_PLACES_COUNTRIES ??
    process.env.EXPO_PUBLIC_PLACES_COUNTRIES ??
    ''
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const HAS_PLACES = !!GOOGLE_PLACES_KEY;
export const GOOGLE_KEY = GOOGLE_PLACES_KEY;
