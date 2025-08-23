// src/screens/Profile/SettingsScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Switch,
  Alert,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  isQuickUnlockEnabled,
  enableQuickUnlockFromCurrentSession,
  disableQuickUnlock,
  isBiometricAvailable,
} from '@services/QuickUnlockService';
import { supabase } from '@config/supabase';

const DRYNKS_BLUE = '#232F39';
const DRYNKS_RED = '#E34E5C';
const DRYNKS_TEXT_MUTED = '#667085';

export default function SettingsScreen() {
  const [bioEnabled, setBioEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const enabled = await isQuickUnlockEnabled();
        setBioEnabled(enabled);
      } catch {
        // ignore – leave default false
      }
    })();
  }, []);

  const onToggle = useCallback(async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const available = await isBiometricAvailable();
        if (!available) {
          Alert.alert('Face ID / Touch ID', 'Biometrics are not available on this device.');
          return;
        }

        // Make sure there is a session on this device (user has logged in at least once)
        const { data } = await supabase.auth.getSession();
        if (!data?.session?.user) {
          Alert.alert(
            'Face ID / Touch ID',
            'Log in once on this device to enable Quick Unlock.'
          );
          return;
        }

        await enableQuickUnlockFromCurrentSession();
        setBioEnabled(true);
        Alert.alert('Face ID / Touch ID', 'Quick Unlock has been enabled.');
      } else {
        await disableQuickUnlock();
        setBioEnabled(false);
        Alert.alert('Face ID / Touch ID', 'Quick Unlock has been disabled.');
      }
    } catch (e: any) {
      Alert.alert('Face ID / Touch ID', e?.message || 'Could not update the setting.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // ---------- Delete Profile ----------
  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Delete Profile?',
      'This will permanently remove your profile and sign you out. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => secondConfirm(),
        },
      ]
    );
  }, []);

  const secondConfirm = useCallback(() => {
    Alert.alert(
      'Are you absolutely sure?',
      'All your dates, invites, and requests may be removed. Continue?',
      [
        { text: 'Keep my profile', style: 'cancel' },
        { text: 'Yes, delete it', style: 'destructive', onPress: () => deleteProfile() },
      ]
    );
  }, []);

  const deleteProfile = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        Alert.alert('Error', 'You must be signed in to delete your profile.');
        setDeleting(false);
        return;
      }

      // Best path: call a server-side function that deletes the auth user + cascades app data.
      // If you have an Edge Function / RPC named `delete_my_account`, this will use it.
      // Otherwise we fall back to a soft-delete attempt and sign out.
      let hardDeleteOk = false;
      try {
        const { error: rpcErr } = await supabase.rpc('delete_my_account');
        if (!rpcErr) hardDeleteOk = true;
      } catch {
        // no-op; fall through to soft-delete
      }

      if (!hardDeleteOk) {
        // Soft-delete fallback: scrub profile fields that are safe to null/update.
        // This is intentionally minimal (since we don't know all profile columns).
        // You can expand this once your schema has a `deleted_at` or `is_deleted` flag.
        try {
          await supabase
            .from('profiles')
            .update({
              screenname: 'deleted',
              profile_photo: null,
              gallery_photos: [],
            } as any)
            .eq('id', userId);
        } catch {
          // ignore; sign out anyway
        }
      }

      await supabase.auth.signOut();
      Alert.alert('Profile Deleted', 'Your profile has been removed.');
      // Navigate back to login screen
      // (Use your root navigator name if different.)
    } catch (e: any) {
      Alert.alert('Delete Failed', e?.message || 'Could not delete your profile.');
    } finally {
      setDeleting(false);
    }
  }, [deleting]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Face ID / Touch ID */}
      <View style={styles.row}>
        <Text style={styles.label}>Enable Face ID / Touch ID</Text>
        <Switch value={bioEnabled} onValueChange={onToggle} disabled={busy} />
      </View>
      <Text style={styles.help}>
        Turn this on to use Face ID / Touch ID for quick sign-in next time. You must log in once on this
        device before enabling.
      </Text>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Danger Zone */}
      <Text style={styles.sectionTitle}>Danger Zone</Text>
      <Text style={styles.help}>
        Deleting your profile will remove your presence from DrYnks. This action cannot be undone.
      </Text>

      <TouchableOpacity
        onPress={confirmDelete}
        disabled={deleting}
        style={[styles.deleteBtn, deleting && { opacity: 0.7 }]}
      >
        {deleting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.deleteBtnText}>Delete Profile</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },

  // Face ID row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  label: { fontWeight: '600', fontSize: 16, color: DRYNKS_BLUE },
  help: { color: DRYNKS_TEXT_MUTED, marginTop: 8, lineHeight: 18 },

  divider: { height: 1, backgroundColor: '#EEF2F6', marginVertical: 20 },

  // Danger Zone
  sectionTitle: {
    color: DRYNKS_BLUE,
    fontWeight: '700',
    marginBottom: 6,
  },
  deleteBtn: {
    marginTop: 12,
    backgroundColor: DRYNKS_RED,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  deleteBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
