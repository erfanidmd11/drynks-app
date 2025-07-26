// CreateDateScreen.tsx – Updated with full logging for location input

import 'react-native-get-random-values';
import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity, Alert, ActivityIndicator, Platform, Image, KeyboardAvoidingView
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { v4 as uuidv4 } from 'uuid';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import { Ionicons } from '@expo/vector-icons';
import tzlookup from 'tz-lookup';
import CustomLocationInput from '@components/CustomLocationInput';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#FFFFFF';
const DRYNKS_WHITE = '#FFFFFF';

const CreateDateScreen = () => {
  const navigation = useNavigation();
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState(null);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [photoPath, setPhotoPath] = useState(null);
  const [whoPays, setWhoPays] = useState('50/50');
  const [maxAttendees, setMaxAttendees] = useState('');
  const [genderPrefs, setGenderPrefs] = useState({ Male: '', Female: '', TS: '' });
  const [orientationPref, setOrientationPref] = useState('Straight');
  const [eventType, setEventType] = useState('date');
  const [loading, setLoading] = useState(false);

  const handleLocationUpdate = ({ name, latitude, longitude }) => {
    console.log('📍 Location selected in CreateDateScreen:', name, latitude, longitude);
    setLocation(name);
    setCoords({ latitude, longitude });
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      if (photoPath) {
        await supabase.storage.from('date-photos').remove([photoPath]);
        setPhotoPath(null);
      }
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhoto(manipulated.uri);
    }
  };

  const deletePhoto = async () => {
    if (photoPath) await supabase.storage.from('date-photos').remove([photoPath]);
    setPhoto(null);
    setPhotoPath(null);
  };

  const uploadPhoto = async (uri, userId) => {
    const filePath = `${userId}/${uuidv4()}.jpg`;
    const formData = new FormData();
    formData.append('file', {
      uri,
      name: filePath.split('/').pop(),
      type: 'image/jpeg',
    });
    const { data, error } = await supabase.storage.from('date-photos').upload(filePath, formData, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error || !data) throw error;
    const { data: urlData } = supabase.storage.from('date-photos').getPublicUrl(data.path);
    setPhotoPath(filePath);
    return urlData?.publicUrl;
  };

  const handleSubmit = async () => {
  if (!title || !location || !date || !coords || !maxAttendees) {
    Alert.alert('Missing Info', 'Please complete all required fields.');
    return;
  }
  const totalSpots = parseInt(maxAttendees);
  const totalGenders = Object.values(genderPrefs).reduce((sum, val) => sum + parseInt(val || '0'), 0);
  if (totalGenders === 0 || totalGenders > totalSpots - 1) {
    Alert.alert('Gender Selection Required', `Please specify how many of each gender you're inviting (excluding yourself). Max allowed: ${totalSpots - 1}`);
    return;
  }
  setLoading(true);
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    const email = userData?.user?.email;
    if (!userId || !email) {
      Alert.alert('Session Error', 'You must be logged in to create a date.');
      navigation.navigate('Login');
      return;
    }
    let photoUrl = null;
    if (photo) {
      photoUrl = await uploadPhoto(photo, userId);
    }
    const timezone = tzlookup(coords.latitude, coords.longitude);
    const { data, error: dateError } = await supabase
      .from('date_requests')
      .insert([{
        id: uuidv4(),
        title,
        location,
        event_date: date.toISOString(),
        event_timezone: timezone,
        who_pays: whoPays,
        spots: totalSpots,
        preferred_gender_counts: {
          Male: parseInt(genderPrefs.Male || '0', 10),
          Female: parseInt(genderPrefs.Female || '0', 10),
          TS: parseInt(genderPrefs.TS || '0', 10),
        },
        orientation_preference: Array.isArray(orientationPref) ? orientationPref : [orientationPref],
        event_type: eventType,
        creator: userId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        photo_urls: photoUrl ? [photoUrl] : [],
        profile_photo: photoUrl,
        pending_users: [],
        accepted_users: [],
        declined_users: []
      }]);
    if (dateError) throw dateError;
    Alert.alert('Success', 'Your date has been created!');
    navigation.navigate('InviteNearby', {
      dateId: data?.[0]?.id,
      eventLocation: coords,
      genderPrefs,
      orientationPref: Array.isArray(orientationPref) ? orientationPref : [orientationPref]
    });
  } catch (err) {
    console.error('[Create Date Error]', err);
    Alert.alert('Error', err.message || 'Something went wrong');
  } finally {
    setLoading(false);
  }
};

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DRYNKS_WHITE }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AnimatedScreenWrapper showLogo={false} showBack onBack={() => navigation.goBack()} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeIn.duration(600)}>
            <Text style={styles.header}>🎉 Plan Your First Date</Text>
            <TextInput
              style={styles.input}
              placeholder="Name of the event or experience ✨"
              value={title}
              onChangeText={setTitle}
            />
            <View style={{ zIndex: 999, marginBottom: 12 }}>
  <CustomLocationInput
    value={location}
    onLocationSelect={handleLocationUpdate}
  />
</View>
            <TouchableOpacity onPress={() => setShowDatePicker(true)}>
              <Text style={styles.dateButton}>{date ? date.toDateString() : '🗓️ Pick a Date'}</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <View style={{ backgroundColor: '#fff', padding: 10 }}>
                <DateTimePicker
                  mode="date"
                  display="default"
                  value={date || new Date()}
                  onChange={(e, selectedDate) => {
                    if (selectedDate) setDate(selectedDate);
                    setShowDatePicker(false);
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            )}
            <TouchableOpacity onPress={pickImage} style={styles.photoBox}>
              {photo ? (
                <View>
                  <Animated.Image entering={ZoomIn} source={{ uri: photo }} style={styles.photo} />
                  <TouchableOpacity onPress={deletePhoto} style={styles.deleteIcon}>
                    <Ionicons name="close-circle" size={28} color={DRYNKS_RED} />
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={{ color: '#666', textAlign: 'center', paddingHorizontal: 20 }}>
                  📸 Tap here to upload a photo of the event — totally optional!
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.label}>Who Pays?</Text>
            {['I am paying', '50/50', 'Looking for sponsor'].map(opt => (
              <TouchableOpacity key={opt} onPress={() => setWhoPays(opt)}>
                <Text style={[styles.option, whoPays === opt && styles.optionSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.label}>Orientation Preference</Text>
            {['Straight', 'Gay/Lesbian', 'Bisexual', 'Pansexual', 'Everyone'].map(opt => (
              <TouchableOpacity key={opt} onPress={() => setOrientationPref(opt)}>
                <Text style={[styles.option, orientationPref === opt && styles.optionSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.label}>Event Type</Text>
            {['date', 'hangout', 'activity'].map(opt => (
              <TouchableOpacity key={opt} onPress={() => setEventType(opt)}>
                <Text style={[styles.option, eventType === opt && styles.optionSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}
            <TextInput
              style={styles.input}
              placeholder="Including you, how many are going?"
              keyboardType="number-pad"
              value={maxAttendees}
              onChangeText={setMaxAttendees}
            />
            <Text style={styles.label}>Preferred Gender Count</Text>
            {['Male', 'Female', 'TS'].map(g => (
              <TextInput
                key={g}
                style={styles.input}
                placeholder={`How many ${g}s do you want to invite (not including you)?`}
                keyboardType="number-pad"
                value={genderPrefs[g]}
                onChangeText={val => setGenderPrefs(prev => ({ ...prev, [g]: val }))}
              />
            ))}
            <View style={styles.footerWrap}>
              <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Animated.Text entering={FadeInUp.duration(300)} style={styles.submitText}>
                    Finish & Continue
                  </Animated.Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </AnimatedScreenWrapper>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: DRYNKS_WHITE,
    flexGrow: 1,
    paddingBottom: 100,
  },
  header: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
  },
  dateButton: {
    padding: 14,
    backgroundColor: DRYNKS_GRAY,
    textAlign: 'center',
    borderRadius: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  photoBox: {
    height: 180,
    borderRadius: 12,
    backgroundColor: DRYNKS_GRAY,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  photo: {
    width: 180,
    height: 180,
    borderRadius: 12,
  },
  deleteIcon: {
    position: 'absolute',
    top: -8,
    right: -8,
  },
  label: {
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 6,
    fontSize: 16,
    color: DRYNKS_BLUE,
  },
  option: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    marginBottom: 10,
    textAlign: 'center',
    fontSize: 15,
    backgroundColor: DRYNKS_GRAY,
  },
  optionSelected: {
    backgroundColor: DRYNKS_RED,
    color: DRYNKS_WHITE,
    borderColor: DRYNKS_RED,
  },
  footerWrap: {
    paddingVertical: 20,
  },
  submitButton: {
    backgroundColor: DRYNKS_RED,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitText: {
    color: DRYNKS_WHITE,
    fontWeight: '600',
    fontSize: 18,
  },
});

export default CreateDateScreen;
