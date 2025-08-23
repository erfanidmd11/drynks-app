import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Text,
  TouchableWithoutFeedback,
  Keyboard,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { clearCredentials } from '@utils/secureStore';

export default function EnterOtpScreen() {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);

  // Cast to 'any' to avoid route typing fights while we finish global types
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { email, password } = (route.params ?? {}) as { email: string; password: string };

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [resendCooldown]);

  const handleVerify = async () => {
    if (!otp || otp.trim().length < 6) {
      Alert.alert('OTP Required', 'Please enter the 6-digit code.');
      return;
    }

    if (!email || !password) {
      Alert.alert('Missing Credentials', 'Please start the signup process again.');
      navigation.goBack();
      return;
    }

    try {
      setLoading(true);

      // Verify signup OTP for email
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'signup',
      });

      if (verifyError) {
        Alert.alert('OTP Error', verifyError.message);
        return;
      }

      // Sign in after successful verification
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        Alert.alert('Login Error', signInError.message);
        return;
      }

      const userId = signInData?.user?.id;
      if (userId) {
        await supabase.from('profiles').upsert({
          id: userId,
          email,
          current_step: 'ProfileSetupStepTwo',
        });
      }

      await clearCredentials();
      // Cast the route name so TS doesn't block you
      navigation.navigate('ProfileSetupStepTwo' as never);
    } catch (error) {
      Alert.alert('Unexpected Error', 'Something went wrong during verification.');
      console.error('[OTP ERROR]', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      // Resend email signup — keep options simple (no channel, no null)
      await supabase.auth.signUp({
        email,
        password,
        options: {}, // <-- removed emailRedirectTo: null
      });
      setResendCooldown(30);
      Alert.alert('OTP Sent', 'A new OTP has been sent to your email.');
    } catch (error) {
      console.error('[Resend OTP ERROR]', error);
      Alert.alert('Error', 'Could not resend OTP.');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View>
          <Image
            source={require('@assets/images/DrYnks_Y_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.label}>Enter the 6-digit OTP sent to your email</Text>
          <TextInput
            placeholder="OTP"
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            style={styles.input}
            maxLength={6}
            autoFocus
            returnKeyType="done"
            blurOnSubmit
          />

          <TouchableOpacity
            style={styles.button}
            onPress={handleVerify}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify OTP Code</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.resendButton, resendCooldown > 0 && styles.resendDisabled]}
            onPress={handleResend}
            disabled={resendCooldown > 0}
          >
            <Text style={styles.resendText}>
              {resendCooldown > 0
                ? `Resend OTP in ${resendCooldown}s`
                : 'Resend OTP Code'}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  logo: {
    width: 80,
    height: 80,
    alignSelf: 'center',
    marginBottom: 20,
  },
  backButton: {
    marginBottom: 16,
  },
  backText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    borderRadius: 6,
    marginBottom: 16,
    fontSize: 16,
  },
  label: {
    fontSize: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#ff5a5f',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resendButton: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 10,
  },
  resendDisabled: {
    opacity: 0.4,
  },
  resendText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '500',
  },
});
