// src/screens/Profile/EditProfileScreen.tsx
// EditProfileScreen – robust uploads, locked identity fields, Google Places autocomplete
// (3+ chars dropdown), preferences (multi), orientation (single), profile/gallery (min 3, max 10),
// replace & promote-to-profile, square-crop picking + resizeMode="contain" display.
// Header: center logo now uses DrYnks_Y_logo.png instead of letter "Y".
// FIXES: (1) Location input is single-line; current-location button is on its own line.
//        (2) KeyboardAvoidingView so keyboard never covers the input or the dropdown.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Image,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Platform,
  SafeAreaView,
  StatusBar,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import { decode as atob } from 'base-64';
import { v4 as uuidv4 } from 'uuid';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@config/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Chip from '@components/ui/Chip';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';
const BG = '#F7F8FA';

const { width } = Dimensions.get('window');
const PROFILE_BUCKET = 'profile-photos'; // public bucket recommended
const MAX_GALLERY = 10;
const MIN_GALLERY = 3;

type ProfileRow = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  screenname?: string | null;
  profile_photo?: string | null;
  gallery_photos?: string[] | null;
  about?: string | null; // or bio
  bio?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  birthdate?: string | null;
  gender?: string | null;
  orientation?: string | null;
  preferences?: string[] | null;
};

const ORIENTATIONS = ['Straight', 'Gay/Lesbian', 'Bisexual', 'Pansexual', 'Everyone'] as const;
const GENDER_PREFS = ['Male', 'Female', 'TS'] as const;
const GOOGLE_API_KEY = (process.env.EXPO_PUBLIC_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '') as string;

// Optional: restrict autocomplete to these countries (comma-separated)
const COUNTRIES: string[] = String(
  (process.env as any)?.EXPO_PUBLIC_PLACES_COUNTRIES || 'us,ca'
)
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

// ---------------------- Utilities
function ageFromBirthdate(birthdate?: string | null) {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(+d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

async function ensureMediaLibraryPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission required', 'We need access to your photos to continue.');
    return false;
  }
  return true;
}

async function uploadImageToStorage(localUri: string, userId: string): Promise<string> {
  // Compress before upload
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 1080 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  );

  const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const filePath = `${userId}/${uuidv4()}.jpg`;
  const { data, error } = await supabase.storage
    .from(PROFILE_BUCKET)
    .upload(filePath, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '31536000',
    });

  if (error || !data) throw error || new Error('Upload failed');

  const pub = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(data.path);
  const url = pub?.data?.publicUrl;
  if (!url) throw new Error('Could not resolve public URL for uploaded image');
  return url;
}

// ---------------------- Location Autocomplete (robust)
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

const LocationAutocomplete: React.FC<{
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (sel: PlaceSelection) => void;
}> = ({ value, onChangeText, onSelect }) => {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canAutocomplete = Boolean(GOOGLE_API_KEY);

  useEffect(() => {
    if (!canAutocomplete) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = value.trim();
    if (query.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    // Open immediately at 3+ chars (spinner while querying)
    setOpen(true);

    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const components =
          COUNTRIES.length > 0 ? `&components=${COUNTRIES.map((c) => `country:${c}`).join('|')}` : '';
        const common = `input=${encodeURIComponent(query)}&language=en&key=${GOOGLE_API_KEY}&locationbias=ipbias${components}`;

        // Try city-only
        let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${common}&types=(cities)`;
        let res = await fetch(url);
        let json = await res.json();

        let items: PlaceSuggestion[] = [];
        if (json?.status === 'OK' && Array.isArray(json?.predictions) && json.predictions.length) {
          items = json.predictions.map((p: any) => ({ place_id: p.place_id, description: p.description }));
        } else {
          // Retry without types, then filter to city-like results
          url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${common}`;
          res = await fetch(url);
          json = await res.json();
          if (json?.status === 'OK' && Array.isArray(json?.predictions)) {
            const filtered = json.predictions.filter(isCityPrediction);
            items = filtered.map((p: any) => ({ place_id: p.place_id, description: p.description }));
          }
        }

        setSuggestions(items);
        setOpen(items.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, canAutocomplete]);

  const fetchPlace = async (place_id: string) => {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(place_id)}` +
        `&fields=geometry,address_components,formatted_address,name` +
        `&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const r = json?.result;
      const lat = r?.geometry?.location?.lat;
      const lng = r?.geometry?.location?.lng;

      const comps: any[] = r?.address_components || [];
      const locality = comps.find((c: any) => c.types.includes('locality'))?.long_name;
      const admin1 = comps.find((c: any) => c.types.includes('administrative_area_level_1'))?.short_name;
      const country = comps.find((c: any) => c.types.includes('country'))?.short_name;
      const label = [locality, admin1, country].filter(Boolean).join(', ') || r?.name || r?.formatted_address;

      if (typeof lat === 'number' && typeof lng === 'number') {
        onSelect({ name: label, latitude: lat, longitude: lng });
        setOpen(false);
        setSuggestions([]);
      }
    } catch {
      // ignore
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
    } catch {
      Alert.alert('Error', 'Could not fetch current location.');
    }
  };

  return (
    <View style={{ position: 'relative' }}>
      {/* Single-line city input (full width) */}
      <TextInput
        value={value}
        onChangeText={(t) => {
          onChangeText(t);
          if (t.trim().length >= MIN_QUERY_LEN) setOpen(true);
        }}
        placeholder="City, State"
        placeholderTextColor="#9AA4AF"
        style={[styles.input]}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
      />

      {/* Current location on its own line (so long city names are fully visible) */}
      <TouchableOpacity onPress={useCurrentLocation} style={styles.locFullBtn} accessibilityLabel="Use my current location">
        <Ionicons name="location" size={16} color={DRYNKS_BLUE} />
        <Text style={styles.locBtnText}>Use My Current Location</Text>
      </TouchableOpacity>

      {/* Suggestions dropdown anchored to input */}
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
                  activeOpacity={0.7}
                >
                  <Ionicons name="location-outline" size={16} color="#6B7280" />
                  <Text numberOfLines={1} style={styles.suggestionText}>{s.description}</Text>
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

// ---------------------- Glass Back Button
const GlassBackButton: React.FC<{
  onPress: () => void;
  tint?: 'light' | 'dark' | 'default';
  label?: string;
  color?: string;
}> = ({ onPress, tint = 'dark', label = 'Back', color = '#ffffff' }) => {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderRadius: 999,
          overflow: 'hidden',
          transform: [{ scale: pressed ? 0.97 : 1 }],
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        },
      ]}
      android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
    >
      <BlurView
        intensity={28}
        tint={tint}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: tint === 'light'
            ? 'rgba(0,0,0,0.06)'
            : 'rgba(255,255,255,0.15)',
        }}
      >
        <Ionicons name="chevron-back" size={18} color={color} />
        <Text style={{ color, fontWeight: '700', letterSpacing: 0.2 }}>{label}</Text>
      </BlurView>
    </Pressable>
  );
};

// ---------------------- Screen
const EditProfileScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute() as any;
  const insets = useSafeAreaInsets();

  // Glass header layout
  const TOP_ROW = 44;
  const BACK_ROW = 48;
  const HEADER_SPACING = 10;
  const HEADER_H = insets.top + TOP_ROW + BACK_ROW + HEADER_SPACING;

  const originFrom = route?.params?.from;

  const [me, setMe] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Locked identity
  const [firstName, setFirstName] = useState<string>('');
  const [screenname, setScreenname] = useState<string>('');
  const [gender, setGender] = useState<string | null>(null);
  const [birthdate, setBirthdate] = useState<string | null>(null);

  // Editable fields
  const [about, setAbout] = useState<string>('');
  const [aboutFieldKey, setAboutFieldKey] = useState<'about' | 'bio' | null>(null);
  const [location, setLocation] = useState<string>('');
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
  const [orientation, setOrientation] = useState<string>('Straight');
  const [preferences, setPreferences] = useState<string[]>([]);

  // Photos
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [gallery, setGallery] = useState<string[]>([]);

  const age = useMemo(() => ageFromBirthdate(birthdate), [birthdate]);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const goBackSmart = () => {
    if (originFrom) navigation.navigate(originFrom);
    else if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('PublicProfile');
  };

  // Load profile
  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess?.session?.user?.id || null;
        setMe(uid);
        if (!uid) {
          setLoading(false);
          return;
        }
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', uid)
          .single();
        if (error) throw error;

        const p = data as ProfileRow;

        setProfile(p);
        setFirstName(p.first_name || '');
        setScreenname(p.screenname || '');
        setGender(p.gender || null);
        setBirthdate(p.birthdate || null);

        // about/bio detection
        const hasAbout = Object.prototype.hasOwnProperty.call(p, 'about');
        const hasBio = Object.prototype.hasOwnProperty.call(p, 'bio');
        setAboutFieldKey(hasAbout ? 'about' : hasBio ? 'bio' : null);
        setAbout(hasAbout ? (p.about || '') : hasBio ? (p.bio || '') : '');

        setLocation(p.location || '');
        setCoords({ latitude: p.latitude ?? null, longitude: p.longitude ?? null });
        setOrientation(p.orientation || 'Straight');
        setPreferences(Array.isArray(p.preferences) ? p.preferences : []);

        setAvatarUrl(p.profile_photo || '');
        setGallery(Array.isArray(p.gallery_photos) ? p.gallery_photos : []);
      } catch (err) {
        Alert.alert('Error', 'Could not load your profile.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const togglePref = (value: string) => {
    setPreferences(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]));
  };

  const replaceGalleryAt = async (index: number) => {
    try {
      const ok = await ensureMediaLibraryPermission();
      if (!ok) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // square crop to match display tiles
        quality: 0.9,
      });
      if ((result as any).canceled) return;
      const uri = (result as any).assets?.[0]?.uri;
      if (!uri) return;
      setGallery((prev) => {
        const copy = [...prev];
        copy[index] = uri; // local; upload on save
        return copy;
      });
    } catch {
      Alert.alert('Error', 'Could not pick an image.');
    }
  };

  const addGalleryPhoto = async () => {
    if (gallery.length >= MAX_GALLERY) {
      Alert.alert('Limit reached', `You can upload up to ${MAX_GALLERY} gallery photos.`);
      return;
    }
    try {
      const ok = await ensureMediaLibraryPermission();
      if (!ok) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // square crop
        quality: 0.9,
      });
      if ((result as any).canceled) return;
      const uri = (result as any).assets?.[0]?.uri;
      if (!uri) return;
      setGallery((prev) => [...prev, uri]);
    } catch {
      Alert.alert('Error', 'Could not pick an image.');
    }
  };

  const removeGalleryAt = (index: number) => {
    if (gallery.length <= MIN_GALLERY) {
      Alert.alert('Minimum photos', `You must keep at least ${MIN_GALLERY} gallery photos.`);
      return;
    }
    setGallery((prev) => prev.filter((_, i) => i !== index));
  };

  const promoteToAvatar = (uri: string) => {
    if (!uri) return;
    setAvatarUrl(uri);
  };

  const pickAvatar = async () => {
    try {
      const ok = await ensureMediaLibraryPermission();
      if (!ok) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // square crop for circular avatar
        quality: 0.95,
      });
      if ((result as any).canceled) return;
      const uri = (result as any).assets?.[0]?.uri;
      if (!uri) return;
      setAvatarUrl(uri); // local; upload on save
    } catch {
      Alert.alert('Error', 'Could not pick an image.');
    }
  };

  const movePhoto = (index: number, dir: 'up' | 'down') => {
    setGallery((prev) => {
      const copy = [...prev];
      const j = dir === 'up' ? index - 1 : index + 1;
      if (j < 0 || j >= copy.length) return copy;
      [copy[index], copy[j]] = [copy[j], copy[index]];
      return copy;
    });
  };

  const handleSave = async () => {
    if (!me || !profile) return;

    if (!avatarUrl) {
      Alert.alert('Profile photo required', 'Please set a profile photo.');
      return;
    }
    if (gallery.length < MIN_GALLERY) {
      Alert.alert('Not enough photos', `Please keep at least ${MIN_GALLERY} gallery photos.`);
      return;
    }

    try {
      setSaving(true);

      const safeLocation = location?.trim() ? location.trim() : (profile.location || '');
      const finalLat = coords.latitude ?? profile.latitude ?? null;
      const finalLng = coords.longitude ?? profile.longitude ?? null;

      // Upload any local images (non-HTTP)
      const ensureUrl = async (uri: string): Promise<string> => {
        if (/^https?:\/\//i.test(uri)) return uri;
        return await uploadImageToStorage(uri, me);
      };

      const finalAvatar = await ensureUrl(avatarUrl);
      const finalGallery = await Promise.all(gallery.map(ensureUrl));

      const updates: Record<string, any> = {
        profile_photo: finalAvatar,
        gallery_photos: finalGallery,
        location: safeLocation,
        latitude: finalLat,
        longitude: finalLng,
        orientation,
        preferences,
      };
      if (aboutFieldKey) updates[aboutFieldKey] = about;

      const { error } = await supabase.from('profiles').update(updates).eq('id', me);
      if (error) throw error;

      if (!aboutFieldKey) {
        Alert.alert(
          'Saved',
          'Profile updated successfully.\n(Note: About could not be saved because your database lacks an "about" or "bio" column.)'
        );
      } else {
        Alert.alert('Saved', 'Profile updated successfully.');
      }

      goBackSmart();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG }}>
        <ActivityIndicator size="large" color={DRYNKS_RED} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG, paddingTop: HEADER_H }}>
      <StatusBar barStyle="dark-content" />

      {/* Glass Header */}
      <View style={styles.headerWrap} pointerEvents="box-none">
        <BlurView intensity={28} tint="dark" style={[styles.headerGlass, { paddingTop: insets.top }]}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => navigation.navigate('ProfileMenu')} accessibilityLabel="Open Profile Menu">
              {profile?.profile_photo ? (
                <Image source={{ uri: profile.profile_photo }} style={styles.headerProfilePic} resizeMode="cover" />
              ) : (
                <View style={styles.headerProfilePlaceholder} />
              )}
            </TouchableOpacity>

            {/* Center logo: DrYnks_Y_logo.png instead of letter Y */}
            <Image
              source={require('@assets/images/DrYnks_Y_logo.png')}
              style={styles.headerLogoImg}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />

            <TouchableOpacity onPress={() => navigation.navigate('Notifications')} accessibilityLabel="Open Notifications">
              <Ionicons name="notifications-outline" size={22} color={DRYNKS_WHITE} />
            </TouchableOpacity>
          </View>

          <View style={styles.headerBottom}>
            <GlassBackButton onPress={goBackSmart} tint="dark" label="Back" color="#fff" />
            <View style={{ width: 48 }} />
          </View>
        </BlurView>
      </View>

      {/* KeyboardAvoidingView ensures keyboard never covers input or dropdown */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={HEADER_H} // push content by header height
      >
        {/* Content */}
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
        >
          {/* Locked fields */}
          <Text style={styles.section}>Your identity (locked)</Text>

          <Text style={styles.label}>Screen name</Text>
          <View style={[styles.input, { paddingVertical: 12 }]}>
            <Text style={styles.readonly}>{screenname || '-'}</Text>
          </View>

          <Text style={styles.label}>First name</Text>
          <View style={[styles.input, { paddingVertical: 12 }]}>
            <Text style={styles.readonly}>{firstName || '-'}</Text>
          </View>

          <Text style={styles.label}>Gender</Text>
          <View style={[styles.input, { paddingVertical: 12 }]}>
            <Text style={styles.readonly}>{gender || '-'}</Text>
          </View>

          <Text style={styles.label}>Date of birth</Text>
          <View style={[styles.input, { paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between' }]}>
            <Text style={styles.readonly}>{birthdate ? new Date(birthdate).toDateString() : '-'}</Text>
            <Text style={[styles.readonly, { opacity: 0.8 }]}>{typeof age === 'number' ? `${age} yrs` : ''}</Text>
          </View>

          {/* Profile details */}
          <Text style={styles.section}>Profile details</Text>

          <Text style={styles.label}>Location</Text>
          <View style={{ zIndex: 1000 }}>
            <LocationAutocomplete
              value={location}
              onChangeText={setLocation}
              onSelect={({ name, latitude, longitude }) => {
                setLocation(name);
                setCoords({ latitude, longitude });
              }}
            />
          </View>

          <Text style={styles.label}>Who are you into?</Text>
          <View style={styles.rowWrap}>
            {GENDER_PREFS.map(g => (
              <Chip key={g} label={g} active={preferences.includes(g)} onPress={() => togglePref(g)} />
            ))}
          </View>

          <Text style={styles.label}>Sexual orientation</Text>
          <View style={styles.rowWrap}>
            {ORIENTATIONS.map(o => (
              <Chip key={o} label={o} active={orientation === o} onPress={() => setOrientation(o)} />
            ))}
          </View>

          <Text style={styles.label}>About</Text>
          <TextInput
            style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
            multiline
            value={about}
            onChangeText={setAbout}
            placeholder="Tell others a bit about you… (optional)"
            placeholderTextColor="#9AA4AF"
          />
          {!aboutFieldKey && (
            <Text style={{ color: '#6B7280', marginTop: 6 }}>
              Heads up: Your database does not have an <Text style={{ fontWeight: '700' }}>"about"</Text> or <Text style={{ fontWeight: '700' }}>"bio"</Text> column yet. This text won’t be saved until you add one.
            </Text>
          )}

          <Text style={styles.section}>Photos</Text>

          {/* Avatar */}
          <Text style={styles.label}>Profile photo</Text>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.85}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} resizeMode="contain" />
            ) : (
              <View style={[styles.avatar, { backgroundColor: '#eef2f7', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: '#667085' }}>Tap to add profile photo</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Gallery */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 6 }}>
            <Text style={[styles.label, { marginTop: 0 }]}>Gallery photos (min {MIN_GALLERY}, max {MAX_GALLERY})</Text>
            <Text style={{ marginLeft: 'auto', color: '#6B7280' }}>{gallery.length}/{MAX_GALLERY}</Text>
          </View>

          <FlatList
            data={gallery}
            keyExtractor={(item, i) => `${item}-${i}`}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingVertical: 6 }}
            renderItem={({ item, index }) => (
              <View style={styles.thumbWrap}>
                <Image source={{ uri: item }} style={styles.galleryPhoto} resizeMode="contain" />
                <View style={styles.thumbActions}>
                  <TouchableOpacity onPress={() => promoteToAvatar(item)} style={styles.actionBtn}>
                    <Text style={styles.actionText}>Make Profile</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => replaceGalleryAt(index)} style={styles.actionBtn}>
                    <Text style={styles.actionText}>Replace</Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                    <TouchableOpacity onPress={() => movePhoto(index, 'up')} style={[styles.pillBtn, { opacity: index === 0 ? 0.4 : 1 }]}>
                      <Text style={styles.pillText}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => movePhoto(index, 'down')} style={[styles.pillBtn, { opacity: index === gallery.length - 1 ? 0.4 : 1 }]}>
                      <Text style={styles.pillText}>↓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => removeGalleryAt(index)}
                      style={[styles.pillBtn, { backgroundColor: '#fee2e2', borderColor: '#fecaca' }]}
                      disabled={gallery.length <= MIN_GALLERY}
                    >
                      <Text style={[styles.pillText, { color: '#b91c1c' }]}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />

          <TouchableOpacity style={styles.addButton} onPress={addGalleryPhoto} activeOpacity={0.88}>
            <Text style={styles.addText}>+ Add More Photos</Text>
          </TouchableOpacity>

          {/* Bottom actions: Save + Cancel */}
          <TouchableOpacity onPress={handleSave} style={[styles.saveButton, saving && { opacity: 0.7 }]} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>💾 Save Changes</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={goBackSmart} style={styles.cancelButton} activeOpacity={0.85}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // Glass header
  headerWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 50,
  },
  headerGlass: {
    backgroundColor: 'rgba(0,0,0,0.18)',
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  headerBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    marginTop: 6,
  },
  headerProfilePic: { width: 32, height: 32, borderRadius: 16 },
  headerProfilePlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#888' },
  headerLogoImg: { width: 28, height: 28, tintColor: DRYNKS_WHITE }, // center Y logo

  // Form container (content sits below header via root paddingTop)
  container: { paddingHorizontal: 20, paddingBottom: 40 },
  section: { fontSize: 12, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 6 },
  label: { fontSize: 14, fontWeight: '600', color: DRYNKS_BLUE, marginTop: 12 },

  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
    backgroundColor: '#fff',
    color: '#111827',
  },
  readonly: { color: '#111827', fontSize: 16 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },

  // Avatar
  avatar: {
    width: Math.min(160, width * 0.6),
    height: Math.min(160, width * 0.6),
    borderRadius: 999,
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#eef2f7',
  },

  // Gallery
  thumbWrap: { marginRight: 12, alignItems: 'center' },
  galleryPhoto: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginTop: 6,
    backgroundColor: '#f3f4f6',
  },
  thumbActions: { marginTop: 6, alignItems: 'center' },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    marginTop: 6,
  },
  actionText: { color: '#111827', fontWeight: '600', fontSize: 12 },

  pillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  pillText: { color: '#111827', fontWeight: '700' },

  addButton: {
    marginTop: 12,
    backgroundColor: DRYNKS_BLUE,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  addText: { color: '#fff', fontWeight: '700' },

  saveButton: {
    backgroundColor: DRYNKS_RED,
    padding: 16,
    borderRadius: 30,
    marginTop: 18,
    alignItems: 'center',
  },
  saveText: { color: DRYNKS_WHITE, fontWeight: '700', fontSize: 16 },

  cancelButton: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 30,
    alignItems: 'center',
    backgroundColor: '#EEF0F2',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cancelText: { color: '#232F39', fontWeight: '800' },

  // Autocomplete
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
  locBtnText: { color: DRYNKS_BLUE, fontWeight: '600' },

  suggestionsWrap: {
    position: 'absolute',
    top: 54, // directly beneath the input
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 4,
    zIndex: 2000,
    maxHeight: 260,
    ...Platform.select({ android: { elevation: 8 } }),
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
});

export default EditProfileScreen;
