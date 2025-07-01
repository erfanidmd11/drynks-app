// VerifyBanner.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { supabase } from '../../config/supabase';

const VerifyBanner = ({ profile }: { profile: any }) => {
  const [emailLoading, setEmailLoading] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(true);

  const handleEmailVerify = async () => {
    setEmailLoading(true);
    try {
      await supabase.auth.reauthenticate();
      setMessage('📬 Boom! Verification email is flying your way.');
    } catch (err) {
      setMessage(`❌ Error: ${err.message}`);
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePhoneVerify = async () => {
    setPhoneLoading(true);
    try {
      await supabase.auth.verifyOtp({ type: 'sms', phone: profile.phone });
      setMessage('📱 Code sent! Check your texts.');
    } catch (err) {
      setMessage(`❌ Error: ${err.message}`);
    } finally {
      setPhoneLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <Animated.View entering={FadeIn} style={styles.banner}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Verify Your Account 🛡️</Text>
        <TouchableOpacity onPress={() => setVisible(false)}>
          <Text style={styles.dismiss}>Got it</Text>
        </TouchableOpacity>
      </View>

      {!profile.email_verified && (
        <View style={styles.row}>
          <Text style={styles.label}>{profile.email}</Text>
          {emailLoading ? (
            <ActivityIndicator />
          ) : (
            <TouchableOpacity onPress={handleEmailVerify}><Text style={styles.link}>Send Email</Text></TouchableOpacity>
          )}
        </View>
      )}

      {!profile.phone_verified && (
        <View style={styles.row}>
          <Text style={styles.label}>{profile.phone}</Text>
          {phoneLoading ? (
            <ActivityIndicator />
          ) : (
            <TouchableOpacity onPress={handlePhoneVerify}><Text style={styles.link}>Send Code</Text></TouchableOpacity>
          )}
        </View>
      )}

      {message && <Text style={styles.message}>{message}</Text>}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fff5e0',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  dismiss: {
    color: '#007AFF',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: '#555',
  },
  link: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  message: {
    marginTop: 10,
    color: 'green',
    fontWeight: '500',
  },
});

export default VerifyBanner;
