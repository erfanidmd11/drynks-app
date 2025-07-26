import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform,
  ScrollView, TouchableWithoutFeedback, Keyboard
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';
import { supabase } from '@config/supabase';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const orientations = ['Straight', 'Gay/Lesbian', 'Bisexual', 'Pansexual', 'Everyone'];

const SignupStepEleven = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const userId = route.params?.userId;
  const { screenname } = route.params || {};
  const [selected, setSelected] = useState(null);

  const handleNext = async () => {
    if (!selected) {
      Alert.alert('Missing Selection', 'Select your sexual orientation to continue.');
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({ orientation: selected })
      .eq('id', userId);

    if (error) {
      Alert.alert('Error', 'Could not save orientation.');
      return;
    }

    navigation.reset({ index: 0, routes: [{ name: 'App' }] });
  };

  return (
    <AnimatedScreenWrapper>
      <KeyboardAvoidingView style={styles.scrollContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
            <Text style={styles.header}>{screenname ? `Last Step, @${screenname}! 🌈` : 'Last Step! 🌈'}</Text>
            <Text style={styles.subtext}>Who are you into? Pick your orientation:</Text>

            {orientations.map(opt => (
              <TouchableOpacity key={opt} style={[styles.option, selected === opt && styles.selectedOption]} onPress={() => setSelected(opt)}>
                <Text style={[styles.optionText, selected === opt && styles.selectedText]}>{opt}</Text>
              </TouchableOpacity>
            ))}

            <View style={{ marginTop: 20 }}>
              <OnboardingNavButtons onNext={handleNext} />
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
    color: DRYNKS_BLUE,
  },
  subtext: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 20,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
    width: '100%',
    alignItems: 'center',
  },
  selectedOption: {
    backgroundColor: DRYNKS_RED,
  },
  optionText: {
    fontSize: 16,
    color: '#333',
  },
  selectedText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default SignupStepEleven;
