// SignupStepNine.tsx – Final Production Ready with City Picker Geocoding

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  TouchableOpacity,
} from 'react-native';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const popularCities = [
  'Los Angeles', 'Miami', 'Boston', 'New York', 'Philadelphia',
  'San Jose', 'San Francisco', 'San Diego', 'Las Vegas',
  'Chicago', 'Dallas', 'Austin', 'Atlanta'
];

const SignupStepNine = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { screenname, first_name, phone } = route.params || {};
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState({ latitude: null, longitude: null });

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({});
      const geo = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (geo.length > 0) setLocation(geo[0].city || '');
      setCoords({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    })();
  }, []);

  const handleUseCurrentLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({});
      const geo = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (geo.length > 0) {
        setLocation(geo[0].city || '');
        setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    } catch (err) {
      Alert.alert('Location Error', 'Could not fetch current location.');
    }
  };

  const handleCityPress = async (city) => {
    try {
      setLocation(city);
      const results = await Location.geocodeAsync(city);
      if (results.length > 0) {
        setCoords({
          latitude: results[0].latitude,
          longitude: results[0].longitude,
        });
      }
    } catch (error) {
      console.error('Geocoding error:', error);
    }
  };

  const handleNext = async () => {
    if (!screenname || !first_name || !phone) {
      Alert.alert('Missing Info', 'Your signup session is incomplete. Please restart the signup process.');
      navigation.navigate('ProfileSetupStepOne');
      return;
    }

    if (!location) {
      Alert.alert('Where You At?', 'Please select or enter your city.');
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
      location,
      latitude: coords.latitude,
      longitude: coords.longitude,
      current_step: 'ProfileSetupStepNine',
    });

    if (upsertError) {
      console.error('[Supabase Upsert Error]', upsertError);
      Alert.alert('Error', 'Could not save your location.');
      return;
    }

    navigation.navigate('ProfileSetupStepTen', {
      screenname,
      first_name,
      phone,
    });
  };

  return (
    <AnimatedScreenWrapper>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
            <Text style={styles.header}>
              {screenname ? `Where You Chillin’, @${screenname}? 📍` : 'Where You Chillin’? 📍'}
            </Text>
            <Text style={styles.subtext}>
              We’ve auto-filled your location, but feel free to change it or pick from our party hot list.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Enter your city"
              value={location}
              onChangeText={setLocation}
              placeholderTextColor="#999"
            />

            <TouchableOpacity onPress={handleUseCurrentLocation} style={{ marginVertical: 10 }}>
              <Text style={{ color: '#232F39', fontWeight: '600' }}>📍 Use My Current Location</Text>
            </TouchableOpacity>

            <View style={styles.cityGrid}>
              {popularCities.map(city => (
                <TouchableOpacity
                  key={city}
                  style={[styles.cityButton, location === city && styles.cityButtonSelected]}
                  onPress={() => handleCityPress(city)}
                >
                  <Text style={[styles.cityButtonText, location === city && styles.cityButtonTextSelected]}>
                    {city}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 30 }}>
              <OnboardingNavButtons onNext={handleNext} disabled={!location} />
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
    paddingHorizontal: 20,
    justifyContent: 'center',
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
  cityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  cityButton: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    backgroundColor: '#f2f2f2',
    borderRadius: 20,
    margin: 5,
    borderColor: '#ccc',
    borderWidth: 1,
  },
  cityButtonSelected: {
    backgroundColor: '#ff5a5f',
    borderColor: '#ff5a5f',
  },
  cityButtonText: {
    fontSize: 14,
    color: '#333',
  },
  cityButtonTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default SignupStepNine;
