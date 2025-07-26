// Enhanced VerifyBanner.tsx with Branding and Logic Improvements

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { supabase } from '@config/supabase';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#E1EBF2';
const DRYNKS_WHITE = '#FFFFFF';

const VerifyBanner = ({ profile }: { profile: any }) => {
  const [emailLoading, setEmailLoading] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(true);
  const [verifiedStatus, setVerifiedStatus] = useState({ email: false, phone: false });

  useEffect(() => {
    const fetchStatus = async () => {
      const { data: userData } = await supabase.auth.getUser();
      setVerifiedStatus({
        email: userData?.user?.email_confirmed_at !== null,
        phone: userData?.user?.phone_confirmed_at !== null,
      });
    };
    fetchStatus();
  }, []);

  const handleEmailVerify = async () => {
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'email' });
      if (error) throw error;
      setMessage('📬 Boom! Verification email is flying your way.');
    } catch (err: any) {
      setMessage(`❌ Error: ${err.message}`);
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePhoneVerify = async () => {
    setPhoneLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ type: 'sms', phone: profile.phone });
      if (error) throw error;
      setMessage('📱 Code sent! Check your texts.');
    } catch (err: any) {
      setMessage(`❌ Error: ${err.message}`);
    } finally {
      setPhoneLoading(false);
    }
  };

  if (!visible || (verifiedStatus.email && verifiedStatus.phone)) return null;

  return (
    <Animated.View entering={FadeIn} style={styles.banner}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Verify Your Account 🛡️</Text>
        <TouchableOpacity onPress={() => setVisible(false)}>
          <Text style={styles.dismiss}>Got it</Text>
        </TouchableOpacity>
      </View>

      {!verifiedStatus.email && (
        <View style={styles.row}>
          <Text style={styles.label}>{profile.email}</Text>
          {emailLoading ? (
            <ActivityIndicator color={DRYNKS_BLUE} />
          ) : (
            <TouchableOpacity onPress={handleEmailVerify}>
              <Text style={styles.link}>Resend Email</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!verifiedStatus.phone && (
        <View style={styles.row}>
          <Text style={styles.label}>{profile.phone}</Text>
          {phoneLoading ? (
            <ActivityIndicator color={DRYNKS_BLUE} />
          ) : (
            <TouchableOpacity onPress={handlePhoneVerify}>
              <Text style={styles.link}>Send Code</Text>
            </TouchableOpacity>
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
    color: DRYNKS_BLUE,
  },
  dismiss: {
    color: DRYNKS_RED,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: DRYNKS_BLUE,
  },
  link: {
    color: DRYNKS_RED,
    fontWeight: 'bold',
  },
  message: {
    marginTop: 10,
    color: DRYNKS_BLUE,
    fontWeight: '500',
  },
});

export default VerifyBanner;