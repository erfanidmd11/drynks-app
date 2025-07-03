// SignupStepEight.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const SignupStepEight = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { username } = route.params as { username: string };

  const [socialHandle, setSocialHandle] = useState('');
  const [platform, setPlatform] = useState('');

  const handleNext = async () => {
    if (!platform || !socialHandle) {
      Alert.alert('Optional Step', 'This is optional, but helps us verify real users.');
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      await supabase.from('profiles').upsert({
        id: userData.user.id,
        social_platform: platform,
        social_handle: socialHandle,
        current_step: 'ProfileSetupStepEight',
      });
    }

    navigation.navigate('ProfileSetupStepNine', { username });
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>Almost There, @{username}! 🔐</Text>
        <Text style={styles.subtext}>
          Drop your Instagram, TikTok, or Facebook handle — just one! This will never be shared, it’s just our way of keeping DrYnks safe and spam-free for everyone. 🍸
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Platform (IG, TikTok, FB)"
          value={platform}
          onChangeText={setPlatform}
          autoCapitalize="none"
          placeholderTextColor="#999"
        />

        <TextInput
          style={styles.input}
          placeholder="@yourhandle"
          value={socialHandle}
          onChangeText={setSocialHandle}
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
    marginBottom: 10,
    textAlign: 'center',
  },
  subtext: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 20,
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

export default SignupStepEight;
