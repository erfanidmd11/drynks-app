// src/screens/Onboarding/SignupStepThree.tsx

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
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '@components/common/OnboardingNavButtons';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

const SignupStepThree = () => {
  const navigation = useNavigation<any>();

  const [firstName, setFirstName] = useState('');
  const [screenname, setScreenname] = useState('');
  const [screennameValid, setScreennameValid] = useState<null | boolean>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const generateSuggestions = (base: string) => {
    const suffix = Math.floor(Math.random() * 1000);
    return [`${base}${suffix}`, `${base}_${suffix}`, `${base}${suffix + 1}`];
  };

  const checkScreennameAvailability = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('screenname')
      .eq('screenname', trimmed);

    if (error) {
      Alert.alert('Error', 'Unable to check screenname.');
      setScreennameValid(null);
      return;
    }

    if ((data?.length ?? 0) > 0) {
      setScreennameValid(false);
      setSuggestions(generateSuggestions(trimmed));
    } else {
      setScreennameValid(true);
    }
  };

  const handleNext = async () => {
    const trimmedFirstName = firstName.trim();
    const trimmedScreenname = screenname.trim();

    if (!trimmedFirstName || !trimmedScreenname) {
      Alert.alert('Missing Info', 'Both your first name and screenname are required.');
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id || !userData.user.email) {
      Alert.alert('Error', 'Unable to retrieve user information.');
      return;
    }

    const { user } = userData;

    const { data: existing, error: dupCheckError } = await supabase
      .from('profiles')
      .select('id')
      .eq('screenname', trimmedScreenname);

    if (dupCheckError) {
      console.error('[Dup Check Error]', dupCheckError);
      Alert.alert('Error', 'Error checking screenname uniqueness.');
      return;
    }

    if ((existing?.length ?? 0) > 0 && existing![0].id !== user.id) {
      Alert.alert('Screenname Taken', 'Please choose a different screenname.');
      return;
    }

    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      screenname: trimmedScreenname,
      first_name: trimmedFirstName,
      current_step: 'ProfileSetupStepThree',
    });

    if (upsertError) {
      Alert.alert('Signup Error', upsertError.message);
      return;
    }

    // Cast nav params to stop "never" overload error
    navigation.navigate('ProfileSetupStepFour' as never, {
      screenname: trimmedScreenname,
      first_name: trimmedFirstName,
    } as never);
  };

  const isNextDisabled =
    !firstName.trim() || !screenname.trim() || screennameValid !== true;

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={60}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.header}>Let’s Put a Name to That Smile 😄</Text>

            <TextInput
              style={styles.input}
              placeholder="First Name"
              value={firstName}
              onChangeText={setFirstName}
              placeholderTextColor="#8A94A6"
            />

            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.inputWithIcon}
                placeholder="Screenname (must be unique)"
                value={screenname}
                onChangeText={(val) => {
                  setScreenname(val);
                  setScreennameValid(null);
                }}
                onBlur={() => checkScreennameAvailability(screenname)}
                autoCapitalize="none"
                placeholderTextColor="#8A94A6"
              />
              {screenname.length > 0 && screennameValid !== null && (
                <Text style={styles.statusIcon}>
                  {screennameValid ? '✅' : '❌'}
                </Text>
              )}
            </View>

            <OnboardingNavButtons
              onNext={handleNext}
              {...({ disabled: isNextDisabled } as any)}  // cast extra prop for TS
            />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: DRYNKS_WHITE,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 20,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  input: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 15,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
  inputWrapper: {
    position: 'relative',
    marginBottom: 15,
  },
  inputWithIcon: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingRight: 40,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
  statusIcon: {
    position: 'absolute',
    right: 10,
    top: 12,
    fontSize: 20,
  },
  error: {
    color: DRYNKS_RED,
    fontWeight: '600',
    marginBottom: 4,
  },
  suggestion: {
    color: '#55606B',
  },
});

export default SignupStepThree;
