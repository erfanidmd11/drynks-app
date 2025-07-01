// CreateDateScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, Alert, Button } from 'react-native';
import { supabase } from '../../config/supabase';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { v4 as uuidv4 } from 'uuid';

const CreateDateScreen = () => {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [whoPays, setWhoPays] = useState('50/50');
  const [maxAttendees, setMaxAttendees] = useState('2');
  const [genderPrefs, setGenderPrefs] = useState({ Male: '0', Female: '0', TS: '0' });
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLatitude(loc.coords.latitude);
        setLongitude(loc.coords.longitude);
      }
    })();
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled && result.assets[0].uri) {
      setPhotos(prev => [...prev, result.assets[0].uri]);
      if (!profilePhoto) setProfilePhoto(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!title || !location || !date || photos.length === 0) {
      Alert.alert('Missing info', 'Please fill all required fields and upload at least one photo.');
      return;
    }

    const user = await supabase.auth.getUser();
    const inviteCode = uuidv4();

    const dateRequest = {
      title,
      location,
      event_date: date.toISOString(),
      who_pays: whoPays,
      spots: parseInt(maxAttendees),
      preferred_gender_counts: {
        Male: parseInt(genderPrefs.Male),
        Female: parseInt(genderPrefs.Female),
        TS: parseInt(genderPrefs.TS),
      },
      creator: user.data.user.id,
      invite_code: inviteCode,
      latitude,
      longitude,
      photo_urls: photos,
      profile_photo: profilePhoto,
      pending_users: [],
      accepted_users: [],
      declined_users: []
    };

    const { error } = await supabase.from('date_requests').insert([dateRequest]);
    if (error) Alert.alert('Error', error.message);
    else Alert.alert('Success', 'Date posted!');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Create a Date</Text>

      <TextInput style={styles.input} placeholder="Event Title" value={title} onChangeText={setTitle} />
      <TextInput style={styles.input} placeholder="Location" value={location} onChangeText={setLocation} />

      <TouchableOpacity onPress={() => setShowDatePicker(true)}>
        <Text style={styles.dateButton}>{date ? date.toDateString() : 'Pick a Date'}</Text>
      </TouchableOpacity>
      {showDatePicker && (
        <DateTimePicker
          mode="date"
          display="default"
          value={date || new Date()}
          onChange={(e, selectedDate) => {
            setShowDatePicker(false);
            if (selectedDate) setDate(selectedDate);
          }}
        />
      )}

      <TouchableOpacity onPress={pickImage} style={styles.button}><Text style={styles.buttonText}>Add Photo</Text></TouchableOpacity>
      {photos.map((uri, idx) => (
        <Text key={idx} style={styles.photoText}>{uri}</Text>
      ))}

      <Text style={styles.label}>Who Pays?</Text>
      {['I am paying', '50/50', 'Looking for sponsor'].map(opt => (
        <TouchableOpacity key={opt} onPress={() => setWhoPays(opt)}>
          <Text style={[styles.option, whoPays === opt && styles.optionSelected]}>{opt}</Text>
        </TouchableOpacity>
      ))}

      <TextInput
        style={styles.input}
        placeholder="Max Attendees"
        keyboardType="number-pad"
        value={maxAttendees}
        onChangeText={setMaxAttendees}
      />

      <Text style={styles.label}>Preferred Gender Count</Text>
      {['Male', 'Female', 'TS'].map(g => (
        <TextInput
          key={g}
          style={styles.input}
          placeholder={`${g} Count`}
          keyboardType="number-pad"
          value={genderPrefs[g]}
          onChangeText={val => setGenderPrefs(prev => ({ ...prev, [g]: val }))}
        />
      ))}

      <Button title="Submit" onPress={handleSubmit} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  dateButton: {
    padding: 12,
    backgroundColor: '#eee',
    textAlign: 'center',
    borderRadius: 8,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  photoText: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  label: {
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 4,
  },
  option: {
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    marginBottom: 6,
  },
  optionSelected: {
    backgroundColor: '#007AFF',
    color: '#fff',
  },
});

export default CreateDateScreen;
