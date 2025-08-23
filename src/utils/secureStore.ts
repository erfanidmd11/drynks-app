// src/utils/credentials.ts
import * as SecureStore from 'expo-secure-store';

/**
 * Save user credentials securely in the device's keychain.
 * NOTE: For real production apps, you might want to avoid storing plain text passwords.
 * Instead store refresh tokens or session identifiers.
 */
export async function saveCredentials(email: string, password: string): Promise<void> {
  try {
    await SecureStore.setItemAsync('user_email', email, { keychainService: 'dr-ynks' });
    await SecureStore.setItemAsync('user_password', password, { keychainService: 'dr-ynks' });
  } catch (error) {
    console.error('[SecureStore] Failed to save credentials:', error);
  }
}

/**
 * Retrieve stored user credentials.
 * @returns An object with email and password or null values if missing.
 */
export async function getCredentials(): Promise<{ email: string | null; password: string | null }> {
  try {
    const email = await SecureStore.getItemAsync('user_email', { keychainService: 'dr-ynks' });
    const password = await SecureStore.getItemAsync('user_password', { keychainService: 'dr-ynks' });
    return { email, password };
  } catch (error) {
    console.error('[SecureStore] Failed to get credentials:', error);
    return { email: null, password: null };
  }
}

/**
 * Clear stored user credentials from secure storage.
 */
export async function clearCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync('user_email', { keychainService: 'dr-ynks' });
    await SecureStore.deleteItemAsync('user_password', { keychainService: 'dr-ynks' });
  } catch (error) {
    console.error('[SecureStore] Failed to clear credentials:', error);
  }
}
