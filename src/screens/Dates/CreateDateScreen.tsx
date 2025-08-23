// CreateDateScreen.tsx — production ready (insert-first, robust upload, safe time conversion)
// - Insert the date row first, then upload to Supabase Storage 'date-photos', then UPDATE the row
// - 0-byte safe uploads (base64 -> Uint8Array)
// - Uses existing columns only: profile_photo, photo_urls (no schema changes)

import 'react-native-get-random-values';
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
// 🔧 Replace alias with relative path (or remove if unused)
import { RootStackParamList } from '../../types/navigation';
import { supabase } from '@config/supabase';

import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import { v4 as uuidv4 } from 'uuid';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import { Ionicons } from '@expo/vector-icons';
import tzlookup from 'tz-lookup';
import CustomLocationInput from '@components/CustomLocationInput';

// 🔧 Guard date-fns-tz import (named export can differ by version)
import * as dfnsTz from 'date-fns-tz';
const ztUtc = (dfnsTz as any).zonedTimeToUtc as (d: Date | string | number, tz: string) => Date;

// RN-safe base64 decode
import { decode as atob } from 'base-64';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#FFFFFF';
const DRYNKS_WHITE = '#FFFFFF';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'InviteNearby'>;
type Coords = { latitude: number; longitude: number } | null;

const DATE_BUCKET = 'date-photos';

// Safe wrapper: if Intl/timezone support fails in your JS engine, fall back to local->UTC math
const safeZonedTimeToUtc = (d: Date, tz: string) => {
  try {
    return ztUtc(d, tz);
  } catch {
    const ms = d.getTime() - d.getTimezoneOffset() * 60_000;
    return new Date(ms);
  }
};

// base64 → bytes for Supabase upload (RN-safe)
function base64ToUint8Array(b64: string): Uint8Array {
  const bin =
    typeof (globalThis as any).atob === 'function'
      ? (globalThis as any).atob(b64)
      : atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Upload helper (public bucket) — returns { publicUrl, path }
async function uploadToDateBucket(localUri: string, userId: string) {
  // normalize/resize → JPEG first to avoid HEIC/webp/ph:// issues
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 1080 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  );

  const path = `${userId}/${uuidv4()}.jpg`;

  // Read local file as base64 → Uint8Array (0-byte safe)
  const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToUint8Array(base64);

  // ✅ Use bytes (Uint8Array), not ArrayBufferLike
  const { data, error } = await supabase.storage
    .from(DATE_BUCKET)
    .upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600',
    });

  if (error || !data) throw error || new Error('Upload failed');

  const pub = supabase.storage.from(DATE_BUCKET).getPublicUrl(data.path);
  const publicUrl = pub?.data?.publicUrl || null;
  if (!publicUrl) throw new Error('Public URL not available');

  return { publicUrl, path: data.path };
}

const CreateDateScreen = () => {
  const navigation = useNavigation<NavigationProp>();

  // Form state
  const [title, setTitle] = useState('');
  const [locationName, setLocationName] = useState(''); // city name the host selects
  const [coords, setCoords] = useState<Coords>(null);

  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [photo, setPhoto] = useState<string | null>(null);         // local preview (manipulated)
  const [uploadedPath, setUploadedPath] = useState<string | null>(null); // previously uploaded storage path (if any during this screen)

  const [whoPays, setWhoPays] = useState<'I am paying' | '50/50' | 'Looking for sponsor'>('50/50');
  const [maxAttendees, setMaxAttendees] = useState(''); // includes host

  const [genderPrefs, setGenderPrefs] = useState<Record<string, string>>({
    Male: '',
    Female: '',
    TS: '',
  });

  const [orientationPref, setOrientationPref] = useState('Straight');
  const [eventType, setEventType] = useState<'date' | 'hangout' | 'activity'>('date');
  const [loading, setLoading] = useState(false);

  // Location autocomplete callback
  const handleLocationUpdate = ({
    name,
    latitude,
    longitude,
  }: {
    name: string;
    latitude: number;
    longitude: number;
  }) => {
    setLocationName(name);
    setCoords({ latitude, longitude });
  };

  // Image pick (normalize to jpeg to avoid ph:// issues)
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      // If user re-picks during the same session and we already uploaded a previous file, clean it up
      if (uploadedPath) {
        await supabase.storage.from(DATE_BUCKET).remove([uploadedPath]).catch(() => {});
        setUploadedPath(null);
      }
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhoto(manipulated.uri);
    }
  };

  const deletePhoto = async () => {
    if (uploadedPath) await supabase.storage.from(DATE_BUCKET).remove([uploadedPath]).catch(() => {});
    setPhoto(null);
    setUploadedPath(null);
  };

  const handleSubmit = async () => {
    if (!title || !locationName || !date || !coords || !maxAttendees) {
      Alert.alert('Missing Info', 'Please complete all required fields.');
      return;
    }

    const totalSpots = parseInt(maxAttendees, 10);
    if (Number.isNaN(totalSpots) || totalSpots < 1) {
      Alert.alert('Invalid Capacity', 'Please enter a valid number of attendees.');
      return;
    }

    // Sum gender prefs (excluding host)
    const totalGenders = Object.values(genderPrefs).reduce(
      (sum, val) => sum + parseInt(val || '0', 10),
      0
    );
    if (totalGenders === 0 || totalGenders > totalSpots - 1) {
      Alert.alert(
        'Gender Selection Required',
        `Please specify how many of each gender you're inviting (excluding yourself). Max allowed: ${totalSpots - 1}`
      );
      return;
    }

    setLoading(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const userId = userData?.user?.id;
      const email = userData?.user?.email;
      if (!userId || !email) {
        Alert.alert('Session Error', 'You must be logged in to create a date.');
        // @ts-ignore
        navigation.navigate('Login');
        return;
      }

      // Timezone from coordinates
      const timezone = tzlookup(coords!.latitude, coords!.longitude);

      // End-of-day (local) → UTC ISO string
      const eventDateEnd = new Date(date);
      eventDateEnd.setHours(23, 59, 59, 999);
      const event_date = safeZonedTimeToUtc(eventDateEnd, timezone).toISOString();

      // Reverse geocode for country (optional)
      const place = await Location.reverseGeocodeAsync({
        latitude: coords!.latitude,
        longitude: coords!.longitude,
      });
      const country = place?.[0]?.isoCountryCode || 'USA';

      // 1) Insert the date row FIRST (no image yet) to obtain id
      const payload: any = {
        title,
        location: locationName,
        location_str: locationName,
        location_point: `SRID=4326;POINT(${coords!.longitude} ${coords!.latitude})`,
        event_date,
        event_timezone: timezone,
        who_pays: whoPays,
        spots: totalSpots,
        preferred_gender_counts: {
          Male: parseInt(genderPrefs.Male || '0', 10) || 0,
          Female: parseInt(genderPrefs.Female || '0', 10) || 0,
          TS: parseInt(genderPrefs.TS || '0', 10) || 0,
        },
        remaining_gender_counts: {
          Male: parseInt(genderPrefs.Male || '0', 10) || 0,
          Female: parseInt(genderPrefs.Female || '0', 10) || 0,
          TS: parseInt(genderPrefs.TS || '0', 10) || 0,
        },
        orientation_preference: Array.isArray(orientationPref) ? orientationPref : [orientationPref],
        event_type: eventType,
        creator: userId,
        latitude: coords!.latitude,
        longitude: coords!.longitude,
        // image fields blank for now; we update them after successful upload
        photo_urls: [],
        profile_photo: null,
        pending_users: [],
        accepted_users: [],
        declined_users: [],
        country,
      };

      const { data: inserted, error: dateError } = await supabase
        .from('date_requests')
        .insert([payload])
        .select('id')
        .single();

      if (dateError) throw dateError;
      const dateId: string = inserted.id;

      // 2) If user picked a photo, upload it NOW and update the row
      if (photo) {
        const { publicUrl, path } = await uploadToDateBucket(photo, userId);
        setUploadedPath(path);

        const { error: updateErr } = await supabase
          .from('date_requests')
          .update({
            profile_photo: publicUrl,
            photo_urls: [publicUrl],
          })
          .eq('id', dateId);

        if (updateErr) throw updateErr;
      }

      Alert.alert('Success', 'Your date has been created!');
      navigation.navigate('InviteNearby', {
        dateId,
        eventLocation: { latitude: coords!.latitude, longitude: coords!.longitude },
        genderPrefs,
        orientationPref: Array.isArray(orientationPref) ? orientationPref : [orientationPref],
      });
    } catch (err: any) {
      console.error('[Create Date Error]', err);
      Alert.alert('Error', err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: DRYNKS_WHITE }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 🔧 Cast props to avoid wrapper prop/type mismatch without changing UI */}
      <AnimatedScreenWrapper
        showLogo={false}
        {...({ onBack: () => navigation.goBack(), style: { flex: 1 } } as any)}
      >
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
                value={locationName}
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
            {['I am paying', '50/50', 'Looking for sponsor'].map((opt) => (
              <TouchableOpacity key={opt} onPress={() => setWhoPays(opt as any)}>
                <Text style={[styles.option, whoPays === opt && styles.optionSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.label}>Orientation Preference</Text>
            {['Straight', 'Gay/Lesbian', 'Bisexual', 'Pansexual', 'Everyone'].map((opt) => (
              <TouchableOpacity key={opt} onPress={() => setOrientationPref(opt)}>
                <Text style={[styles.option, orientationPref === opt && styles.optionSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.label}>Event Type</Text>
            {['date', 'hangout', 'activity'].map((opt) => (
              <TouchableOpacity key={opt} onPress={() => setEventType(opt as any)}>
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
            {['Male', 'Female', 'TS'].map((g) => (
              <TextInput
                key={g}
                style={styles.input}
                placeholder={`How many ${g}s do you want to invite (not including you)?`}
                keyboardType="number-pad"
                value={genderPrefs[g] as string}
                onChangeText={(val) => setGenderPrefs((prev) => ({ ...prev, [g]: val }))}
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
