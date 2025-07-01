// SignupStepNine.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import { Picker } from '@react-native-picker/picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../config/supabase';
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
  const { username } = route.params as { username: string };

  const [location, setLocation] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

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
    })();
  }, []);

  const handleNext = async () => {
    const finalLocation = selectedCity || location;
    if (!finalLocation) {
      Alert.alert('Where You At?', 'Please select or enter your city.');
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      await supabase.from('profiles').upsert({
        id: userData.user.id,
        location: finalLocation,
        current_step: 'ProfileSetupStepNine',
      });
    }

    navigation.navigate('ProfileSetupStepTen', { username });
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>Where You Chillin’, @{username}? 📍</Text>
        <Text style={styles.subtext}>We’ve auto-filled your location, but feel free to change it or pick from our party hot list.</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter your city"
          value={location}
          onChangeText={setLocation}
          placeholderTextColor="#999"
        />

        <Picker
          selectedValue={selectedCity}
          onValueChange={(item) => setSelectedCity(item)}
          style={styles.picker}>
          <Picker.Item label="Or pick a popular city" value="" />
          {popularCities.map(city => (
            <Picker.Item key={city} label={city} value={city} />
          ))}
        </Picker>

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
  picker: {
    height: 50,
    marginBottom: 20,
  },
});

export default SignupStepNine;
