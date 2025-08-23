// src/screens/Onboarding/SignupStepSeven.tsx

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

const SignupStepSeven = () => {
  // Casts avoid fighting global nav typing while root map is finalized
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const { screenname, first_name, phone } = route.params ?? {};

  const [accepted, setAccepted] = useState(false);

  const handleNext = async () => {
    if (!accepted) {
      Alert.alert('Almost There!', 'Please accept the Terms of Use and Privacy Policy to continue.');
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id || !userData.user.email) {
      Alert.alert('Error', 'User authentication failed.');
      return;
    }

    const { user } = userData;

    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      screenname,
      first_name,
      phone,
      agreed_to_terms: true,
      current_step: 'ProfileSetupStepSeven',
    });

    if (upsertError) {
      console.error('[Supabase Upsert Error]', upsertError);
      Alert.alert('Error', 'Could not save your agreement.');
      return;
    }

    navigation.navigate('ProfileSetupStepEight' as never, {
      screenname,
      first_name,
      phone,
    } as never);
  };

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <View style={styles.container}>
        <Text style={styles.header}>
          {screenname ? `The Fine Print, @${screenname} 📜` : 'The Fine Print 📜'}
        </Text>
        <Text style={styles.subtext}>
          By using DrYnks, you agree to our Terms of Use and Privacy Policy. It helps keep the vibe safe,
          respectful, and spam-free.
        </Text>

        <ScrollView style={styles.termsBox}>
          <Text style={styles.termsText}>
            • You must be 18+ to use DrYnks.{'\n'}
            • Respect all users — no harassment or hate speech.{'\n'}
            • No spamming or fake profiles.{'\n'}
            • We value your privacy. We don’t sell your data.
          </Text>
        </ScrollView>

        <TouchableOpacity onPress={() => setAccepted(!accepted)} style={styles.acceptRow}>
          <Text style={styles.checkbox}>{accepted ? '☑' : '☐'}</Text>
          <Text style={styles.acceptText}>I agree to the Terms of Use and Privacy Policy</Text>
        </TouchableOpacity>

        <OnboardingNavButtons
          onNext={handleNext}
          {...({ disabled: !accepted } as any)}  // cast extra prop to satisfy TS
        />
      </View>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: DRYNKS_WHITE,
    justifyContent: 'center',
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  subtext: {
    fontSize: 14,
    color: '#55606B',
    textAlign: 'center',
    marginBottom: 20,
  },
  termsBox: {
    maxHeight: 160,
    marginBottom: 20,
    padding: 12,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: DRYNKS_GRAY,
  },
  termsText: {
    fontSize: 14,
    color: '#23303A',
    lineHeight: 20,
  },
  acceptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    justifyContent: 'center',
  },
  checkbox: {
    fontSize: 20,
    marginRight: 10,
    color: DRYNKS_BLUE,
  },
  acceptText: {
    fontSize: 14,
    color: '#23303A',
  },
});

export default SignupStepSeven;
