// Fully Patched LoginScreen.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Alert, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../config/supabase';

const LoginScreen = () => {
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password.');
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        Alert.alert('Login Failed', 'We couldn’t find your account. Please sign up first.');
      } else {
        Alert.alert('Login Error', error.message);
      }
    } else {
      Alert.alert('Success', 'Logged in successfully!', [
        { text: 'OK', onPress: () => navigation.replace('App') }
      ]);
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
    <View style={styles.container}>
      <Image source={require('../../../assets/images/drYnks_logo.png')} style={styles.logo} />
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

      <TouchableOpacity onPress={() => navigation.navigate('Signup')}> 
        <Text style={styles.signupText}>Don't have an account? Sign up</Text>
      </TouchableOpacity>
    </View>
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
    color: '#007BFF',
    marginTop: 10,
  },
});

export default LoginScreen;
