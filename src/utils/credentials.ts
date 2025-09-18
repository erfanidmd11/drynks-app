// src/utils/credentials.ts
// Production-ready credential storage (refresh tokens), with backward-compatible
// email/password helpers so existing code keeps working while you migrate.

import * as SecureStore from 'expo-secure-store';

// ========= Keys =========
const KEYCHAIN = 'dr-ynks';
const KEY_EMAIL = 'dr-ynks-email';
const KEY_PASSWORD = 'dr-ynks-pass';           // legacy: avoid in production
const KEY_REFRESH = 'dr-ynks-refresh-token';

// ========= Refresh token (recommended) =========

/** Save a Supabase refresh token securely (preferred over storing a password). */
export async function saveRefreshToken(token: string): Promise<void> {
  try {
    if (token) {
      await SecureStore.setItemAsync(KEY_REFRESH, token, { keychainService: KEYCHAIN });
    }
  } catch (error) {
    console.error('[SecureStore] Failed to save refresh token:', error);
  }
}

/** Get the stored refresh token, or null if missing. */
export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_REFRESH, { keychainService: KEYCHAIN });
  } catch (error) {
    console.error('[SecureStore] Failed to get refresh token:', error);
    return null;
  }
}

/** Clear the stored refresh token. */
export async function clearRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_REFRESH, { keychainService: KEYCHAIN });
  } catch (error) {
    console.error('[SecureStore] Failed to clear refresh token:', error);
  }
}

// ========= Legacy helpers (email/password) =========
// These are kept to avoid breaking existing code. Prefer refresh tokens instead.

/** Save email/password (legacy) — avoid storing plaintext password in production. */
export async function saveCredentials(email: string, password: string): Promise<void> {
  try {
    if (email) await SecureStore.setItemAsync(KEY_EMAIL, email, { keychainService: KEYCHAIN });
    if (password) await SecureStore.setItemAsync(KEY_PASSWORD, password, { keychainService: KEYCHAIN });
  } catch (error) {
    console.error('[SecureStore] Failed to save credentials:', error);
  }
}

/** Retrieve legacy email/password (if still used during migration). */
export async function getCredentials(): Promise<{ email: string | null; password: string | null }> {
  try {
    const email = await SecureStore.getItemAsync(KEY_EMAIL, { keychainService: KEYCHAIN });
    const password = await SecureStore.getItemAsync(KEY_PASSWORD, { keychainService: KEYCHAIN });
    return { email, password };
  } catch (error) {
    console.error('[SecureStore] Failed to get credentials:', error);
    return { email: null, password: null };
  }
}

/** Clear legacy email/password. */
export async function clearCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_EMAIL, { keychainService: KEYCHAIN });
    await SecureStore.deleteItemAsync(KEY_PASSWORD, { keychainService: KEYCHAIN });
  } catch (error) {
    console.error('[SecureStore] Failed to clear credentials:', error);
  }
}
