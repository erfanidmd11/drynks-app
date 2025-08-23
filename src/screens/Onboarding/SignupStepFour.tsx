import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  SafeAreaView,
  Modal,
  FlatList,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

const countryCodes = [
  { label: '+1 (US)', value: '+1' },
  { label: '+44 (UK)', value: '+44' },
  { label: '+61 (Australia)', value: '+61' },
  { label: '+91 (India)', value: '+91' },
  { label: '+33 (France)', value: '+33' },
  { label: '+49 (Germany)', value: '+49' },
  { label: '+81 (Japan)', value: '+81' },
  { label: '+86 (China)', value: '+86' },
  { label: '+34 (Spain)', value: '+34' },
];

const SignupStepFour = () => {
  // Cast to avoid fighting global nav typing while we finish the root map
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { screenname, first_name } = route.params ?? {};

  const [countryCode, setCountryCode] = useState('+1');
  const [phone, setPhone] = useState('');
  const [phoneAvailable, setPhoneAvailable] = useState<boolean | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (phone.length >= 7) checkPhoneAvailability();
    else setPhoneAvailable(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, countryCode]);

  const checkPhoneAvailability = async () => {
    const fullPhone = `${countryCode}${phone}`;
    try {
      setChecking(true);
      const { data: userData, error: authError } = await supabase.auth.getUser();
      if (authError || !userData?.user?.id) {
        setPhoneAvailable(null);
        return;
      }
      const userId = userData.user.id;
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('phone', fullPhone);

      if (error) {
        console.error('[Phone Check Error]', error);
        setPhoneAvailable(null);
        return;
      }

      const isTakenBySomeoneElse = (data?.length ?? 0) > 0 && data![0].id !== userId;
      setPhoneAvailable(!isTakenBySomeoneElse);
    } catch (e) {
      console.error('[Phone Check Error]', e);
      setPhoneAvailable(null);
    } finally {
      setChecking(false);
    }
  };

  const handleNext = async () => {
    const fullPhone = `${countryCode}${phone}`;
    if (!phone || !screenname || !first_name) {
      Alert.alert('Missing Info', 'All fields are required.');
      return;
    }

    try {
      setLoading(true);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.id || !userData.user.email) {
        Alert.alert('Error', 'User authentication failed.');
        return;
      }

      const user = userData.user;

      const { data: existing, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('phone', fullPhone);

      if (checkError) {
        console.error('[Phone Check Error]', checkError);
        Alert.alert('Error', 'Could not validate phone number.');
        return;
      }

      const isTakenBySomeoneElse = (existing?.length ?? 0) > 0 && existing![0].id !== user.id;

      if (isTakenBySomeoneElse) {
        Alert.alert(
          'Phone Number Already In Use',
          'That phone number is already linked to another account.',
          [
            { text: 'Change Number', style: 'cancel' },
            { text: 'Go to Login', onPress: () => navigation.navigate('Login' as never) },
          ]
        );
        return;
      }

      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: user.id,
        email: user.email,
        screenname,
        first_name,
        phone: fullPhone,
        current_step: 'ProfileSetupStepFour',
      });

      if (upsertError) {
        console.error('[Supabase Upsert Error]', upsertError);
        if (
          upsertError.message?.toLowerCase().includes('duplicate') ||
          upsertError.message?.toLowerCase().includes('phone')
        ) {
          Alert.alert(
            'Phone Number Already In Use',
            'That phone number is already linked to another account.',
            [
              { text: 'Change Number', style: 'cancel' },
              { text: 'Go to Login', onPress: () => navigation.navigate('Login' as never) },
            ]
          );
        } else {
          Alert.alert('Database Error', 'Could not save your phone number.');
        }
        return;
      }

      navigation.navigate('ProfileSetupStepFive' as never, {
        screenname,
        first_name,
        phone: fullPhone,
      } as never);
    } catch (err) {
      console.error('[Unexpected Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const renderCountryModal = () => (
    <Modal
      visible={modalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <FlatList
            data={countryCodes}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setCountryCode(item.value);
                  setModalVisible(false);
                }}
                style={styles.countryItem}
              >
                <Text style={styles.countryText}>{item.label}</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.container}>
              <Text style={styles.header}>
                {first_name ? `Hey ${first_name}, what's your number? 📱` : 'How Can We Reach You? 📱'}
              </Text>
              <Text style={styles.subtext}>
                Enter a phone number you can verify. This helps keep DrYnks safe.
              </Text>

              <View style={styles.phoneRow}>
                <Pressable style={styles.codeSelector} onPress={() => setModalVisible(true)}>
                  <Text style={styles.codeText}>{countryCode}</Text>
                </Pressable>
                <View style={{ flex: 1, position: 'relative' }}>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="Phone Number"
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={(text) => setPhone(text.replace(/[^0-9]/g, ''))}
                    placeholderTextColor="#8A94A6"
                  />
                  {phone.length >= 7 && (
                    <Text style={styles.statusIcon}>
                      {checking ? '⏳' : phoneAvailable === true ? '✅' : phoneAvailable === false ? '❌' : ''}
                    </Text>
                  )}
                </View>
              </View>

              <View style={{ marginTop: 20 }}>
                <OnboardingNavButtons
                  onNext={handleNext}
                  {...({ disabled: loading || phoneAvailable === false } as any)}
                />
                {loading && <ActivityIndicator size="large" style={{ marginTop: 20 }} />}
              </View>

              {renderCountryModal()}
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: DRYNKS_WHITE,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  subtext: {
    fontSize: 14,
    color: '#55606B',
    textAlign: 'center',
    marginBottom: 18,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  codeSelector: {
    width: 100,
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: DRYNKS_GRAY,
  },
  codeText: {
    fontSize: 16,
    color: '#1F2A33',
  },
  phoneInput: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 16,
    paddingRight: 40,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
  statusIcon: {
    position: 'absolute',
    right: 10,
    top: 12,
    fontSize: 18,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: DRYNKS_WHITE,
    maxHeight: '40%',
    padding: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  countryItem: {
    paddingVertical: 15,
    paddingHorizontal: 10,
  },
  countryText: {
    fontSize: 18,
    color: '#1F2A33',
  },
});

export default SignupStepFour;
