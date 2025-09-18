// src/screens/CreateDateScreen.tsx
// Production-ready create date flow
// - iOS inline calendar; Android calendar dialog
// - City input is single-line, full width; "Choose My Current Location" is on its own line
// - Autocomplete after 3 chars with sessiontoken + robust fallback chain (types=cities → general → findplace → geocode)
// - DEV-only console diagnostics for Google status/error_message
// - Insert-first, then update photos; strong placeholders; clears form after success

import 'react-native-get-random-values';
import React, { useCallback, useRef, useState } from 'react';
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
  Keyboard,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '@config/supabase';

import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import { v4 as uuidv4 } from 'uuid';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import AnimatedScreenWrapper from '@components/common/AnimatedScreenWrapper';
import { Ionicons } from '@expo/vector-icons';
import tzlookup from 'tz-lookup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode as atob } from 'base-64';

// ---------- Theme
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F4F6F8';
const DRYNKS_WHITE = '#FFFFFF';
const PLACEHOLDER = '#4B5563';

// ---------- Config
const DATE_BUCKET = 'date-photos';
const GOOGLE_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_API_KEY as string) ||
  (process.env.GOOGLE_API_KEY as string) ||
  '';

// Optional: restrict autocomplete countries (comma-separated, e.g., "us,ca")
const COUNTRIES: string[] = String(
  (process.env as any)?.EXPO_PUBLIC_PLACES_COUNTRIES || ''
)
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

// ---------- Date helper
const safeZonedTimeToUtc = (d: Date, tz: string) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { zonedTimeToUtc } = require('date-fns-tz');
    return zonedTimeToUtc(d, tz);
  } catch {
    const ms = d.getTime() - d.getTimezoneOffset() * 60_000;
    return new Date(ms);
  }
};

// ---------- Media helpers
// @ts-ignore – support older/newer expo-image-picker enums
const MEDIA_IMAGES =
  (ImagePicker as any).MediaType?.Images ??
  (ImagePicker as any).MediaTypeOptions?.Images ??
  ImagePicker.MediaTypeOptions.Images;

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = typeof (globalThis as any).atob === 'function' ? (globalThis as any).atob(b64) : atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function uploadToDateBucket(localUri: string, userId: string) {
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 1080 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  );

  const path = `${userId}/${uuidv4()}.jpg`;
  const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToUint8Array(base64);

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

// ---------- City Autocomplete (robust fallbacks + diagnostics)
type PlaceSuggestion = { place_id: string; description: string };
type PlaceSelection = { name: string; latitude: number; longitude: number };
const MIN_QUERY_LEN = 3;

function isCityPrediction(p: any): boolean {
  const t: string[] = Array.isArray(p?.types) ? p.types : [];
  if (t.includes('locality')) return true;
  if (t.includes('administrative_area_level_3') || t.includes('administrative_area_level_2')) return true;
  const desc: string = String(p?.description || '');
  const commas = desc.split(',').length - 1;
  return commas >= 1 && !t.includes('establishment');
}

function labelFromAddressComponents(r: any) {
  const comps: any[] = r?.address_components || [];
  const locality = comps.find((c: any) => c.types.includes('locality'))?.long_name;
  const admin1 = comps.find((c: any) => c.types.includes('administrative_area_level_1'))?.short_name;
  const country = comps.find((c: any) => c.types.includes('country'))?.short_name;
  return [locality, admin1, country].filter(Boolean).join(', ') || r?.formatted_address || r?.name;
}

const LocationAutocomplete: React.FC<{
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (sel: PlaceSelection) => void;
}> = ({ value, onChangeText, onSelect }) => {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<string>(uuidv4());

  const canAutocomplete = Boolean(GOOGLE_API_KEY);

  const resetSession = () => {
    sessionRef.current = uuidv4();
  };

  React.useEffect(() => {
    if (!canAutocomplete) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = value.trim();
    if (query.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    setOpen(true); // show spinner while querying

    debounceRef.current = setTimeout(async () => {
      const sessiontoken = sessionRef.current;
      const components =
        COUNTRIES.length > 0 ? `&components=${COUNTRIES.map((c) => `country:${c}`).join('|')}` : '';
      const common = `input=${encodeURIComponent(query)}&language=en&key=${GOOGLE_API_KEY}&sessiontoken=${sessiontoken}&locationbias=ipbias${components}`;

      try {
        setLoading(true);

        // A) Autocomplete with cities
        let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${common}&types=(cities)`;
        let res = await fetch(url);
        let json = await res.json();

        if (__DEV__) {
          if (json?.status !== 'OK') {
            console.warn('[Places A] status:', json?.status, json?.error_message);
          }
        }

        if (json?.status === 'OK' && Array.isArray(json?.predictions) && json.predictions.length) {
          const items = json.predictions.map((p: any) => ({ place_id: p.place_id, description: p.description }));
          setSuggestions(items);
          setOpen(items.length > 0);
          return;
        }

        // B) General autocomplete, filter to cities
        url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${common}`;
        res = await fetch(url);
        json = await res.json();

        if (__DEV__) {
          if (json?.status !== 'OK') {
            console.warn('[Places B] status:', json?.status, json?.error_message);
          }
        }

        if (json?.status === 'OK' && Array.isArray(json?.predictions) && json.predictions.length) {
          const filtered = json.predictions.filter(isCityPrediction);
          const items = filtered.map((p: any) => ({ place_id: p.place_id, description: p.description }));
          if (items.length > 0) {
            setSuggestions(items);
            setOpen(true);
            return;
          }
        }

        // C) Find Place from Text (textquery)
        url =
          `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
          `?input=${encodeURIComponent(query)}` +
          `&inputtype=textquery` +
          `&fields=place_id,formatted_address,name,geometry` +
          `&key=${GOOGLE_API_KEY}` +
          `&sessiontoken=${sessiontoken}`;
        res = await fetch(url);
        json = await res.json();

        if (__DEV__) {
          if (json?.status !== 'OK') {
            console.warn('[Places C - FindPlace] status:', json?.status, json?.error_message);
          }
        }

        if (json?.status === 'OK' && Array.isArray(json?.candidates) && json.candidates.length) {
          const items = json.candidates.map((c: any) => ({
            place_id: c.place_id,
            description: c.formatted_address || c.name,
          }));
          setSuggestions(items);
          setOpen(items.length > 0);
          return;
        }

        // D) Geocode fallback (use as a single suggestion)
        url =
          `https://maps.googleapis.com/maps/api/geocode/json` +
          `?address=${encodeURIComponent(query)}` +
          `&key=${GOOGLE_API_KEY}`;
        res = await fetch(url);
        json = await res.json();

        if (__DEV__) {
          if (json?.status !== 'OK') {
            console.warn('[Places D - Geocode] status:', json?.status, json?.error_message);
          }
        }

        if (json?.status === 'OK' && Array.isArray(json?.results) && json.results.length) {
          const r = json.results[0];
          const label = labelFromAddressComponents(r);
          const loc = r.geometry?.location;
          if (label && loc?.lat != null && loc?.lng != null) {
            // "geo:" pseudo ID so we can select directly without details call
            setSuggestions([{ place_id: `geo:${loc.lat},${loc.lng}`, description: label }]);
            setOpen(true);
            return;
          }
        }

        // Nothing worked
        setSuggestions([]);
        setOpen(false);
      } catch (e) {
        if (__DEV__) console.warn('[Places ERROR]', e);
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, canAutocomplete]);

  const selectFromGeoPseudo = (place_id: string) => {
    // place_id format: "geo:lat,lng"
    const coords = place_id.replace('geo:', '').split(',');
    const lat = parseFloat(coords[0]);
    const lng = parseFloat(coords[1]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      onSelect({ name: value.trim(), latitude: lat, longitude: lng });
      setOpen(false);
      setSuggestions([]);
      resetSession();
      Keyboard.dismiss();
    }
  };

  const fetchPlace = async (place_id: string) => {
    if (place_id.startsWith('geo:')) {
      selectFromGeoPseudo(place_id);
      return;
    }
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(place_id)}` +
        `&fields=geometry,address_components,formatted_address,name` +
        `&sessiontoken=${sessionRef.current}` +
        `&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();

      if (__DEV__) {
        if (json?.status !== 'OK') {
          console.warn('[Places Details] status:', json?.status, json?.error_message);
        }
      }

      const r = json?.result;
      const lat = r?.geometry?.location?.lat;
      const lng = r?.geometry?.location?.lng;
      const label = labelFromAddressComponents(r);

      if (typeof lat === 'number' && typeof lng === 'number') {
        onSelect({ name: label, latitude: lat, longitude: lng });
        setOpen(false);
        setSuggestions([]);
        resetSession();
        Keyboard.dismiss();
      }
    } catch (e) {
      if (__DEV__) console.warn('[Places Details ERROR]', e);
    }
  };

  const useCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'We need location permission to use your current location.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      const geos = await Location.reverseGeocodeAsync({ latitude, longitude });
      const g = geos?.[0];
      const city = [g?.city || g?.subregion, g?.region, g?.country].filter(Boolean).join(', ');
      onChangeText(city);
      onSelect({ name: city, latitude, longitude });
      setOpen(false);
      setSuggestions([]);
      resetSession();
    } catch {
      Alert.alert('Error', 'Could not fetch current location.');
    }
  };

  return (
    <View style={{ position: 'relative' }}>
      {/* Single-line, full-width input */}
      <TextInput
        value={value}
        onChangeText={(t) => {
          onChangeText(t);
          if (t.trim().length >= MIN_QUERY_LEN) setOpen(true);
          if (t.trim().length === 0) {
            setSuggestions([]);
            setOpen(false);
          }
        }}
        placeholder="Enter city (e.g., San Diego)"
        placeholderTextColor={PLACEHOLDER}
        style={styles.input}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
      />

      {/* Own line for visibility */}
      <TouchableOpacity
        onPress={useCurrentLocation}
        style={styles.locFullBtn}
        accessibilityLabel="Choose My Current Location"
        activeOpacity={0.9}
      >
        <Ionicons name="location" size={16} color={DRYNKS_BLUE} />
        <Text style={styles.locBtnText}>Choose My Current Location</Text>
      </TouchableOpacity>

      {/* Suggestion list */}
      {open && (
        <View style={styles.suggestionsWrap}>
          {loading ? (
            <View style={styles.suggestionItem}>
              <ActivityIndicator size="small" color={DRYNKS_BLUE} />
              <Text style={{ marginLeft: 8, color: '#6b7280' }}>Searching…</Text>
            </View>
          ) : suggestions.length === 0 ? (
            <View style={styles.suggestionItem}>
              <Text style={{ color: '#6b7280' }}>No matches</Text>
            </View>
          ) : (
            <>
              {suggestions.map((s) => (
                <TouchableOpacity
                  key={s.place_id}
                  onPress={() => fetchPlace(s.place_id)}
                  style={styles.suggestionItem}
                  activeOpacity={0.85}
                >
                  <Ionicons name="location-outline" size={16} color="#6B7280" />
                  <Text numberOfLines={1} style={styles.suggestionText}>
                    {s.description}
                  </Text>
                </TouchableOpacity>
              ))}
              <View style={styles.poweredBy}>
                <Text style={styles.poweredText}>Powered by Google</Text>
              </View>
            </>
          )}
        </View>
      )}

      {!GOOGLE_API_KEY && (
        <Text style={{ color: '#9AA4AF', marginTop: 6 }}>
          Autocomplete disabled (missing EXPO_PUBLIC_GOOGLE_API_KEY)
        </Text>
      )}
    </View>
  );
};

// ---------- Helpers
const CLEAR_FLAG = 'createDate:clearOnFocus';

const goToMyDatesTab = (navigation: any) => {
  try {
    navigation.navigate('App', { screen: 'My DrYnks' });
    return;
  } catch {}
  try {
    navigation.navigate('MyDates');
    return;
  } catch {}
  try {
    navigation.navigate('MyDatesScreen');
    return;
  } catch {}
  try {
    navigation.goBack();
  } catch {}
};

// NEW: robust Invite Nearby navigation (tries several route names & parents)
const goToInviteNearby = (navigation: any, dateId: string): boolean => {
  const looksLikeInvite = (name: string) => {
    const n = name.toLowerCase().replace(/[\s_-]/g, '');
    return (
      n.includes('invite') ||
      n.includes('nearbyusers') ||
      n.includes('findnearby') ||
      n.includes('nearby') ||
      n.includes('usersforevent')
    );
  };

  let nav: any = navigation;
  for (let i = 0; i < 5 && nav; i++) {
    const state = nav?.getState?.();
    const routeNames: string[] = Array.isArray(state?.routeNames) ? state.routeNames : [];
    const match = routeNames.find(looksLikeInvite);
    if (match) {
      try {
        nav.navigate(match as never, { dateId, date_id: dateId } as never);
        return true;
      } catch {}
      try {
        nav.navigate(match as never, {
          screen: 'InviteNearbyScreen',
          params: { dateId, date_id: dateId },
        } as never);
        return true;
      } catch {}
    }
    nav = nav?.getParent?.();
  }

  const CANDIDATES = [
    'InviteNearby', 'Invite Nearby', 'InviteUsers', 'Invite Users',
    'Invite', 'NearbyUsersForEvent', 'Nearby Users for Event',
    'NearbyUsers', 'Nearby Users', 'FindNearby', 'Find Nearby',
    'InviteNearbyScreen', 'NearbyUsersForEventScreen',
  ];

  for (const name of CANDIDATES) {
    try {
      navigation.navigate(name as never, { dateId, date_id: dateId } as never);
      return true;
    } catch {}
  }
  return false;
};

// ---------- Screen
const CreateDateScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  // Form state
  const [title, setTitle] = useState('');
  const [locationName, setLocationName] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [date, setDate] = useState(new Date());
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [whoPays, setWhoPays] = useState<'I am paying' | '50/50' | 'Looking for sponsor'>('50/50');
  const [maxAttendees, setMaxAttendees] = useState('');
  const [genderPrefs, setGenderPrefs] = useState<Record<'Male' | 'Female' | 'TS', string>>({
    Male: '',
    Female: '',
    TS: '',
  });
  const [orientationPref, setOrientationPref] = useState<'Straight' | 'Gay/Lesbian' | 'Bisexual' | 'Pansexual' | 'Everyone'>('Straight');
  const [eventType, setEventType] = useState<'date' | 'hangout' | 'activity'>('date');
  const [loading, setLoading] = useState(false);

  // Clear form when re-entering via footer (safety)
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const flag = await AsyncStorage.getItem(CLEAR_FLAG);
        if (mounted && flag === '1') {
          await AsyncStorage.removeItem(CLEAR_FLAG);
          resetForm();
        }
      })();
      return () => {
        mounted = false;
      };
    }, [])
  );

  const handleLocationUpdate = ({ name, latitude, longitude }: { name: string; latitude: number; longitude: number }) => {
    setLocationName(name);
    setCoords({ latitude, longitude });
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'We need access to your photos to continue.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        // @ts-ignore
        mediaTypes: MEDIA_IMAGES,
        allowsEditing: true,
        quality: 0.9,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
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
    } catch {
      Alert.alert('Error', 'Could not open your photo library.');
    }
  };

  const deletePhoto = async () => {
    try {
      if (uploadedPath) await supabase.storage.from(DATE_BUCKET).remove([uploadedPath]).catch(() => {});
      setPhoto(null);
      setUploadedPath(null);
    } catch {
      setPhoto(null);
      setUploadedPath(null);
    }
  };

  const resetForm = useCallback(() => {
    setTitle('');
    setLocationName('');
    setCoords(null);
    setDate(new Date());
    setPhoto(null);
    setUploadedPath(null);
    setWhoPays('50/50');
    setMaxAttendees('');
    setGenderPrefs({ Male: '', Female: '', TS: '' });
    setOrientationPref('Straight');
    setEventType('date');
  }, []);

  const handleSubmit = async () => {
    if (!title || !locationName || !coords || !maxAttendees) {
      Alert.alert('Missing Info', 'Please complete the title, location, date, and capacity.');
      return;
    }

    const totalSpots = parseInt(maxAttendees, 10);
    if (Number.isNaN(totalSpots) || totalSpots < 1) {
      Alert.alert('Invalid Capacity', 'Please enter a valid number of attendees.');
      return;
    }

    const totalGenders = (['Male', 'Female', 'TS'] as const).reduce(
      (sum, key) => sum + (parseInt(genderPrefs[key] || '0', 10) || 0),
      0
    );
    if (totalGenders === 0 || totalGenders > totalSpots - 1) {
      Alert.alert(
        'Gender Selection Required',
        `Please specify how many of each gender you're inviting (excluding yourself). Max allowed: ${Math.max(totalSpots - 1, 0)}`
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
        navigation.navigate('Login' as never);
        return;
      }

      const timezone = tzlookup(coords!.latitude, coords!.longitude);

      // End-of-day (local) → UTC ISO (day-granular)
      const eventDateEnd = new Date(date);
      eventDateEnd.setHours(23, 59, 59, 999);
      const event_date = safeZonedTimeToUtc(eventDateEnd, timezone).toISOString();

      // Reverse geocode country (optional)
      let country = 'USA';
      try {
        const place = await Location.reverseGeocodeAsync({
          latitude: coords!.latitude,
          longitude: coords!.longitude,
        });
        country = place?.[0]?.isoCountryCode || country;
      } catch {}

      // 1) Insert first to get id
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
        orientation_preference: [orientationPref],
        event_type: eventType,
        creator: userId,
        latitude: coords!.latitude,
        longitude: coords!.longitude,
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

      // 2) Upload photo (if any), then update row
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
      // Clear now and set a one-shot flag for next visit via footer
      resetForm();
      await AsyncStorage.setItem(CLEAR_FLAG, '1');

      // --- NEW: Navigate to Invite Nearby (fallback to My Dates if not found)
      const didNav = goToInviteNearby(navigation, dateId);
      if (!didNav) {
        goToMyDatesTab(navigation);
      }
    } catch (err: any) {
      console.error('[Create Date Error]', err);
      Alert.alert('Error', err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  // ---------- Android calendar open
  const openAndroidCalendar = () => {
    DateTimePickerAndroid.open({
      mode: 'date',
      display: 'calendar',
      value: date,
      minimumDate: new Date(),
      onChange: (_evt, selected) => {
        if (selected) setDate(selected);
      },
    });
  };

  // ---------- Friendly formatted date line
  const formattedDate = date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: DRYNKS_WHITE }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AnimatedScreenWrapper showLogo={false} {...({ onBack: () => navigation.goBack(), style: { flex: 1 } } as any)}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeIn.duration(600)}>
            <Text style={styles.header}>🎉 Plan Your Date</Text>

            {/* Title */}
            <Text style={styles.label}>Date Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Name of the event or experience ✨"
              placeholderTextColor={PLACEHOLDER}
              value={title}
              onChangeText={setTitle}
            />

            {/* Location */}
            <Text style={styles.label}>Location</Text>
            <View style={{ zIndex: 1000, marginBottom: 12 }}>
              <LocationAutocomplete
                value={locationName}
                onChangeText={setLocationName}
                onSelect={({ name, latitude, longitude }) =>
                  handleLocationUpdate({ name, latitude, longitude })
                }
              />
            </View>

            {/* Date (Calendar) */}
            <Text style={styles.label}>Date</Text>

            {Platform.OS === 'ios' ? (
              <View style={styles.iosCalendarWrap}>
                <DateTimePicker
                  mode="date"
                  display="inline"
                  value={date}
                  minimumDate={new Date()}
                  onChange={(_e, selected) => {
                    if (selected) setDate(selected);
                  }}
                  style={{ alignSelf: 'stretch' }}
                  // ----- iOS color/readability fixes -----
                  themeVariant="light"               // force light mode so text isn't white on white
                  // @ts-ignore - present in newer types; ignored if not supported
                  accentColor={DRYNKS_RED}           // selected day / control tint
                  // @ts-ignore - may apply to spinner modes; safe no-op for inline on some iOS versions
                  textColor="#111827"
                />
              </View>
            ) : (
              <TouchableOpacity onPress={openAndroidCalendar} activeOpacity={0.9}>
                <Text style={styles.dateButton}>📅 Pick a Date</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.dateSelectedText}>{formattedDate}</Text>

            {/* Photo */}
            <Text style={styles.label}>Event Photo (optional)</Text>
            <TouchableOpacity onPress={pickImage} style={styles.photoBox} activeOpacity={0.9}>
              {photo ? (
                <View>
                  <Animated.Image entering={ZoomIn} source={{ uri: photo }} style={styles.photo} />
                  <TouchableOpacity onPress={deletePhoto} style={styles.deleteIcon} accessibilityLabel="Remove photo">
                    <Ionicons name="close-circle" size={28} color={DRYNKS_RED} />
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={{ color: '#374151', textAlign: 'center', paddingHorizontal: 20 }}>
                  📸 Tap to upload a photo of the event — optional
                </Text>
              )}
            </TouchableOpacity>

            {/* Who Pays */}
            <Text style={styles.label}>Who Pays?</Text>
            {(['I am paying', '50/50', 'Looking for sponsor'] as const).map((opt) => (
              <TouchableOpacity key={opt} onPress={() => setWhoPays(opt)} activeOpacity={0.85}>
                <Text style={[styles.option, whoPays === opt && styles.optionSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}

            {/* Orientation */}
            <Text style={styles.label}>Orientation Preference</Text>
            {(['Straight', 'Gay/Lesbian', 'Bisexual', 'Pansexual', 'Everyone'] as const).map((opt) => (
              <TouchableOpacity key={opt} onPress={() => setOrientationPref(opt)} activeOpacity={0.85}>
                <Text style={[styles.option, orientationPref === opt && styles.optionSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}

            {/* Event Type */}
            <Text style={styles.label}>Event Type</Text>
            {(['date', 'hangout', 'activity'] as const).map((opt) => (
              <TouchableOpacity key={opt} onPress={() => setEventType(opt)} activeOpacity={0.85}>
                <Text style={[styles.option, eventType === opt && styles.optionSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}

            {/* Capacity */}
            <Text style={styles.label}>Capacity (including you)</Text>
            <TextInput
              style={styles.input}
              placeholder="How many are going?"
              placeholderTextColor={PLACEHOLDER}
              keyboardType="number-pad"
              value={maxAttendees}
              onChangeText={setMaxAttendees}
            />

            {/* Gender counts */}
            <Text style={styles.label}>Preferred Gender Count</Text>
            {(['Male', 'Female', 'TS'] as const).map((g) => (
              <TextInput
                key={g}
                style={styles.input}
                placeholder={`How many ${g}s do you want to invite (not including you)?`}
                placeholderTextColor={PLACEHOLDER}
                keyboardType="number-pad"
                value={genderPrefs[g]}
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

// ---------- Styles
const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: DRYNKS_WHITE,
    flexGrow: 1,
    paddingBottom: 100,
  },
  header: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },

  // Labels & Inputs
  label: {
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 6,
    fontSize: 14,
    color: DRYNKS_BLUE,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: DRYNKS_WHITE,
    color: '#111827',
  },

  // Location
  locFullBtn: {
    marginTop: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locBtnText: { color: DRYNKS_BLUE, fontWeight: '700' },
  suggestionsWrap: {
    position: 'absolute',
    top: 54,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 4,
    zIndex: 2000,
    maxHeight: 260,
    ...Platform.select({ android: { elevation: 10 } }),
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
  },
  suggestionText: { color: '#111827', flexShrink: 1 },
  poweredBy: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingVertical: 6,
    alignItems: 'flex-end',
    paddingRight: 10,
    backgroundColor: '#fff',
  },
  poweredText: { fontSize: 10, color: '#9CA3AF' },

  // Date
  iosCalendarWrap: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: DRYNKS_WHITE,
    marginBottom: 8,
  },
  dateButton: {
    padding: 14,
    backgroundColor: DRYNKS_GRAY,
    textAlign: 'center',
    borderRadius: 12,
    marginBottom: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    color: '#111827',
    fontWeight: '700',
  },
  dateSelectedText: {
    color: '#111827',
    fontWeight: '700',
    marginBottom: 12,
  },

  // Photo
  photoBox: {
    height: 180,
    borderRadius: 12,
    backgroundColor: DRYNKS_GRAY,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  photo: { width: 180, height: 180, borderRadius: 12 },
  deleteIcon: { position: 'absolute', top: -8, right: -8 },

  // Options
  option: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 10,
    textAlign: 'center',
    fontSize: 15,
    backgroundColor: DRYNKS_WHITE,
    color: '#111827',
    fontWeight: '600',
  },
  optionSelected: {
    backgroundColor: DRYNKS_RED,
    color: DRYNKS_WHITE,
    borderColor: DRYNKS_RED,
  },

  // Footer
  footerWrap: { paddingVertical: 20 },
  submitButton: {
    backgroundColor: DRYNKS_RED,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitText: { color: DRYNKS_WHITE, fontWeight: '800', fontSize: 18 },
});

export default CreateDateScreen;
