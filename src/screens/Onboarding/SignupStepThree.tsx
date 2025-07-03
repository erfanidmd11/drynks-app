// SignupStepThree.tsx – Production Ready
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '@components/common/OnboardingNavButtons';

const SignupStepThree = () => {
  const navigation = useNavigation();
  const [firstName, setFirstName] = useState('');
  const [username, setUsername] = useState('');

  const generateSuggestions = (base: string) => {
    const suffix = Math.floor(Math.random() * 1000);
    return [`${base}${suffix}`, `${base}_${suffix}`, `${base}${suffix + 1}`];
  };

  const handleNext = async () => {
    const trimmedFirstName = firstName.trim();
    const trimmedUsername = username.trim();

    if (!trimmedFirstName || !trimmedUsername) {
      Alert.alert('Missing Info', 'Both your first name and screenname are required.');
      return;
    }

    try {
      const { data: existing, error: queryError } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', trimmedUsername);

      if (queryError) {
        Alert.alert('Error', 'Could not check username availability.');
        return;
      }

      if (existing && existing.length > 0) {
        const suggestions = generateSuggestions(trimmedUsername);
        Alert.alert(
          'Username Taken',
          `That one's already in use. Try one of these:\n- ${suggestions[0]}\n- ${suggestions[1]}\n- ${suggestions[2]}`
        );
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.id) {
        Alert.alert('Error', 'Unable to retrieve user information.');
        return;
      }

      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: userData.user.id,
        first_name: trimmedFirstName,
        username: trimmedUsername,
        current_step: 'ProfileSetupStepThree',
      });

      if (upsertError) {
        Alert.alert('Signup Error', upsertError.message);
      } else {
        navigation.navigate('ProfileSetupStepFour');
      }
    } catch (err) {
      console.error('[SignupStepThree Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>Let’s Put a Name to That Smile 😄</Text>

        <TextInput
          style={styles.input}
          placeholder="First Name"
          value={firstName}
          onChangeText={setFirstName}
          placeholderTextColor="#999"
        />

        <TextInput
          style={styles.input}
          placeholder="Screenname (must be unique)"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          placeholderTextColor="#999"
        />

        <OnboardingNavButtons onNext={handleNext} />
      </View>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 15,
    fontSize: 16,
  },
});

export default SignupStepThree;
