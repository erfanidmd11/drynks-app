import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const SignupStepEight = () => {
  const navigation = useNavigation();
  const route = useRoute();

  const { screenname, first_name, phone } = route.params || {};

  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [facebook, setFacebook] = useState('');

  const handleNext = async () => {
    if (!screenname || !first_name || !phone) {
      Alert.alert(
        'Missing Data',
        'Your signup session is missing required info. Please restart the signup process.'
      );
      navigation.navigate('ProfileSetupStepOne');
      return;
    }

    if (!instagram && !tiktok && !facebook) {
      Alert.alert(
        'Optional Step',
        'This step is optional, but helps us verify real users.'
      );
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
      instagram_handle: instagram || null,
      facebook_handle: facebook || null,
      tiktok_handle: tiktok || null,
      current_step: 'ProfileSetupStepEight',
    });

    if (upsertError) {
      console.error('[Supabase Upsert Error]', upsertError);
      Alert.alert('Error', 'Could not save social handles.');
      return;
    }

    navigation.navigate('ProfileSetupStepNine', {
      screenname,
      first_name,
      phone,
    });
  };

  return (
    <AnimatedScreenWrapper>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.inner}>
              <Text style={styles.header}>
                {screenname ? `Almost There, @${screenname}! 🔐` : 'Almost There! 🔐'}
              </Text>
              <Text style={styles.subtext}>
                Drop your Instagram, TikTok, or Facebook handle — just one! This will never be shared,
                it’s just our way of keeping DrYnks safe and spam-free for everyone. 🍸
              </Text>

              <TextInput
                style={styles.input}
                placeholder="@instagram"
                value={instagram}
                onChangeText={setInstagram}
                autoCapitalize="none"
                placeholderTextColor="#999"
              />

              <TextInput
                style={styles.input}
                placeholder="@tiktok"
                value={tiktok}
                onChangeText={setTiktok}
                autoCapitalize="none"
                placeholderTextColor="#999"
              />

              <TextInput
                style={styles.input}
                placeholder="@facebook"
                value={facebook}
                onChangeText={setFacebook}
                autoCapitalize="none"
                placeholderTextColor="#999"
              />

              <View style={{ marginTop: 20 }}>
                <OnboardingNavButtons onNext={handleNext} />
              </View>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
  },
  inner: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    backgroundColor: '#fff',
    flexGrow: 1,
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
  input: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 15,
    fontSize: 16,
    backgroundColor: '#fff',
  },
});

export default SignupStepEight;
