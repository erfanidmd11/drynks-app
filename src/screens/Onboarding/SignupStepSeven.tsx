// SignupStepSeven.tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const SignupStepSeven = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { username } = route.params as { username: string };

  const [accepted, setAccepted] = useState(false);

  const handleNext = async () => {
    if (!accepted) {
      Alert.alert('Almost There!', 'Please accept the Terms of Use and Privacy Policy to continue.');
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      await supabase.from('profiles').upsert({
        id: userData.user.id,
        agreed_to_terms: true,
        current_step: 'ProfileSetupStepSeven',
      });
    }

    navigation.navigate('ProfileSetupStepEight', { username });
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>The Fine Print, @{username} 📜</Text>
        <Text style={styles.subtext}>
          By using DrYnks, you agree to our Terms of Use and Privacy Policy. It's our way of keeping the vibe safe, respectful, and spam-free.
        </Text>

        <ScrollView style={styles.termsBox}>
          <Text style={styles.termsText}>
            - You must be 18+ to use DrYnks.{"\n"}
            - Respect all users — no harassment or hate speech.{"\n"}
            - No spamming or fake profiles.{"\n"}
            - We value your privacy. We don’t sell your data.
          </Text>
        </ScrollView>

        <TouchableOpacity onPress={() => setAccepted(!accepted)} style={styles.acceptRow}>
          <Text style={styles.checkbox}>{accepted ? '☑' : '☐'}</Text>
          <Text style={styles.acceptText}>I agree to the Terms of Use and Privacy Policy</Text>
        </TouchableOpacity>

        <OnboardingNavButtons onNext={handleNext} />
      </View>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
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
  termsBox: {
    maxHeight: 150,
    marginBottom: 20,
    padding: 10,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
  },
  termsText: {
    fontSize: 14,
    color: '#333',
  },
  acceptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  checkbox: {
    fontSize: 20,
    marginRight: 10,
  },
  acceptText: {
    fontSize: 14,
  },
});

export default SignupStepSeven;