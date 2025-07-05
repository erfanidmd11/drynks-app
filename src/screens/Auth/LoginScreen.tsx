import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  Platform,
  Keyboard,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';

const getNextIncompleteStep = (profile: any): string | null => {
  if (!profile?.birthdate) return 'ProfileSetupStepTwo';
  if (!profile?.first_name || !profile?.username) return 'ProfileSetupStepThree';
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
        const { error: createError } = await supabase
          .from('profiles')
          .upsert({ id: userId });

        if (createError) {
          Alert.alert('Login Error', 'Could not create profile.');
          return;
        }

        profile = { id: userId };
      }

      const nextStep = getNextIncompleteStep(profile);
      navigation.reset({
        index: 0,
        routes: [{ name: nextStep || 'App' }],
      });
    } catch (err) {
      console.error('[Login Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong during login.');
    }
  };

  const handleForgotPassword = async () => {
    if (Platform.OS === 'ios') {
      Alert.prompt('Forgot Password', 'Enter your email to reset password', async (inputEmail) => {
        if (!inputEmail) return;
        const { error } = await supabase.auth.resetPasswordForEmail(inputEmail);
        if (error) Alert.alert('Error', error.message);
        else Alert.alert('Success', 'Password reset email sent.');
      });
    } else {
      Alert.alert('Reset Password', 'Please contact support to reset your password.');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <Image source={require('../../assets/images/DrYnks_Y_logo.png')} style={styles.logo} />
          <Text style={styles.title}>Your Plus-One for Yacht Parties, Concerts & the Unexpected.</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#999"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#999"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity style={styles.button} onPress={handleLogin}>
            <Text style={styles.buttonText}>Login</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleForgotPassword}>
            <Text style={styles.linkText}>Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('ProfileSetupStepOne')}>
            <Text style={styles.signupText}>Don't have an account? <Text style={styles.signupHighlight}>Sign up</Text></Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
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
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: '#ff5a5f',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  linkText: {
    color: '#007BFF',
    marginBottom: 15,
  },
  signupText: {
    color: '#333',
    marginTop: 10,
    fontSize: 14,
  },
  signupHighlight: {
    color: '#007AFF',
    fontWeight: '600',
  },
});

export default LoginScreen;
