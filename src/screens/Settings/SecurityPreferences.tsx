// src/screens/Settings/SecurityPreferences.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Switch, Alert } from 'react-native';
import {
  isBiometricAvailable as deviceSupportsBiometrics,
  isQuickUnlockEnabled,
  enableQuickUnlock,
  disableQuickUnlock,
} from '@services/QuickUnlockService';
import { supabase } from '@config/supabase';

export default function SecurityPreferences() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      const sup = await deviceSupportsBiometrics();
      const en = await isQuickUnlockEnabled();
      setSupported(sup);
      setEnabled(en);
    })();
  }, []);

  const onToggle = async () => {
    const next = !enabled;

    if (!supported) {
      Alert.alert('Not Supported', 'This device does not support biometrics.');
      return;
    }

    if (next) {
      // Arm Quick Unlock from the current session
      const { data } = await supabase.auth.getSession();
      const refreshToken = data?.session?.refresh_token;
      if (!refreshToken) {
        Alert.alert('Session Error', 'No active session. Please log in again.');
        return;
      }
      try {
        await enableQuickUnlock(refreshToken);
        setEnabled(true);
        Alert.alert('Enabled', 'Quick Unlock has been enabled for this device.');
      } catch (e: any) {
        console.warn('[SecurityPreferences] enableQuickUnlock failed:', e?.message || e);
        Alert.alert('Error', 'Could not enable Quick Unlock.');
      }
    } else {
      try {
        await disableQuickUnlock();
      } catch {}
      setEnabled(false);
      Alert.alert('Disabled', 'Quick Unlock has been disabled on this device.');
    }
  };

  if (!supported) return null;

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontWeight: '600', marginBottom: 8 }}>Quick Unlock</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text>Use Face ID / Device Passcode</Text>
        <View style={{ width: 12 }} />
        <Switch value={enabled} onValueChange={onToggle} />
      </View>
    </View>
  );
}
