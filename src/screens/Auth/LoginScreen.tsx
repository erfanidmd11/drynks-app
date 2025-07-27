// LoginScreen.tsx – Final Production-Ready with Branding + Password View Fix

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  Keyboard, KeyboardAvoidingView, TouchableWithoutFeedback, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import { Ionicons } from '@expo/vector-icons';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#FFFFFF';
const DRYNKS_WHITE = '#FFFFFF';

const getNextIncompleteStep = (profile: any): string | null => {
  if (!profile?.birthdate) return 'ProfileSetupStepTwo';
  if (!profile?.first_name || !profile?.screenname) return 'ProfileSetupStepThree';
  if (!profile?.phone) return 'ProfileSetupStepFour';
  if (!profile?.gender) return 'ProfileSetupStepFive';
  const prefs = profile?.preferences;
  if (!Array.isArray(prefs) || prefs.length === 0) return 'ProfileSetupStepSix';
  if (!profile?.agreed_to_terms) return 'ProfileSetupStepSeven';
  if (!profile?.social_handle || !profile?.social_platform) return 'ProfileSetupStepEight';
  if (!profile?.location) return 'ProfileSetupStepNine';
  const gallery = profile?.gallery_photos;
  if (!profile?.profile_photo || !Array.isArray(gallery) || gallery.length < 3) {
    return 'ProfileSetupStepTen';
  }
  return null;
};

const LoginScreen = () => {
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    console.log('[LoginScreen] Mounted');
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password.');
      return;
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        if (authError.message.toLowerCase().includes('invalid login credentials')) {
          Alert.alert('Login Failed', 'We couldn’t find your account. Please sign up first.');
        } else {
          Alert.alert('Login Error', authError.message);
        }
        return;
      }

      if (!authData?.user?.email_confirmed_at) {
        Alert.alert('Email Not Verified', 'Please verify your email before continuing.');
        return;
      }

      const userId = authData?.user?.id;
      if (!userId) {
        Alert.alert('Login Error', 'User session invalid.');
        return;
      }

      let { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        console.warn('[LoginScreen] No profile found. Creating...');
        const { error: createError } = await supabase.from('profiles').upsert({ id: userId });
        if (createError) {
          Alert.alert('Login Error', 'Could not create profile.');
          return;
        }
        profile = { id: userId };
      }

      const routeData = {
        screenname: profile.screenname,
        first_name: profile.first_name,
        phone: profile.phone,
      };

      if (profile.has_completed_profile) {
        console.log('[Login] Profile complete. Routing to App');
        navigation.reset({ index: 0, routes: [{ name: 'App' }] });
      } else {
        const nextStep = getNextIncompleteStep(profile);
        console.log('[Login] Profile incomplete. Routing to:', nextStep);
        navigation.reset({ index: 0, routes: [{ name: nextStep, params: routeData }] });
      }
    } catch (err) {
      console.error('[Login Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong during login.');
    }
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Reset Password',
      'Please contact support to reset your password or use the Supabase reset email system.'
    );
  };

  return (
    <AnimatedScreenWrapper>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <Text style={styles.title}>
              Your Plus-One for Yacht Parties, Concerts & the Unexpected. test 
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />

            <View style={styles.passwordWrapper}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Password"
                placeholderTextColor="#999"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity style={styles.eyeIcon} onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color="#888" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.button} onPress={handleLogin}>
              <Text style={styles.buttonText}>Login</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleForgotPassword}>
              <Text style={styles.linkText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.navigate('ProfileSetupStepOne')}>
              <Text style={styles.signupText}>
                Don't have an account?{' '}
                <Text style={styles.signupHighlight}>Sign up</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DRYNKS_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
    textAlign: 'center',
    color: DRYNKS_BLUE,
    paddingHorizontal: 10,
  },
  input: {
    width: '100%',
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 15,
    backgroundColor: DRYNKS_GRAY,
  },
  passwordWrapper: {
    width: '100%',
    position: 'relative',
    marginBottom: 15,
  },
  passwordInput: {
    width: '100%',
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: DRYNKS_GRAY,
    paddingRight: 40,
  },
  eyeIcon: {
    position: 'absolute',
    right: 10,
    top: 12,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: DRYNKS_RED,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  buttonText: {
    color: DRYNKS_WHITE,
    fontWeight: 'bold',
    fontSize: 16,
  },
  linkText: {
    color: DRYNKS_BLUE,
    marginBottom: 15,
  },
  signupText: {
    color: DRYNKS_BLUE,
    marginTop: 10,
    fontSize: 14,
  },
  signupHighlight: {
    color: DRYNKS_RED,
    fontWeight: '600',
  },
});

export default LoginScreen;
