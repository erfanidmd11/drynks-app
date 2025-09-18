// src/screens/Onboarding/SignupStepTen.tsx
// Step 10 — Photos + Location
// - Stable, ID-based photo model (prevents header flicker & disappearing profile)
// - Immediate upload of each photo with per-item status (local → uploading → remote)
// - Autosave after every change (profile_photo + gallery_photos) to Supabase + draft
// - Reorder, replace, promote/demote, delete with optimistic UI
// - City autocomplete (Google Places) + "Use My Current Location"

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  FlatList,
  Dimensions,
  Animated,
  TextInput,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import { supabase } from '@config/supabase';
import { useNavigation, useRoute } from '@react-navigation/native';
import OnboardingNavButtons from '@components/common/OnboardingNavButtons';
import { loadDraft, saveDraft } from '@utils/onboardingDraft';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const GOOGLE_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_API_KEY as string) ||
  (process.env.GOOGLE_API_KEY as string) ||
  '';

const MAX = 10;
const MIN = 3;
const screenWidth = Dimensions.get('window').width;
const numColumns = 3;
const colGap = 10;
const horizontalPadding = 20;
const itemSize =
  (screenWidth - horizontalPadding * 2 - (numColumns - 1) * colGap) / numColumns;

const MEDIA_IMAGES =
  // @ts-ignore
  (ImagePicker as any).MediaType?.Images ??
  // @ts-ignore
  (ImagePicker as any).MediaTypeOptions?.Images ??
  ImagePicker.MediaTypeOptions.Images;

const isRemote = (uri?: string | null) => !!uri && /^https?:\/\//i.test(String(uri));

/* ----------------------------- Photo model ----------------------------- */
type PhotoItem = {
  id: string;
  uri: string;                 // local file:// or remote https://
  role: 'profile' | 'gallery'; // exactly one 'profile'
  status: 'local' | 'uploading' | 'remote' | 'failed';
};

type PlaceSuggestion = { place_id: string; description: string };
type PlaceSelection = { name: string; latitude: number; longitude: number };

/* --------------------------- Autocomplete UI --------------------------- */
const MIN_QUERY_LEN = 3;

const LocationAutocomplete: React.FC<{
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (sel: PlaceSelection) => void;
  country?: string; // e.g., 'us' to restrict
}> = ({ value, onChangeText, onSelect, country }) => {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string>(Math.random().toString(36).slice(2));

  const canAutocomplete = Boolean(GOOGLE_API_KEY);

  const resetSessionToken = () => {
    tokenRef.current = Math.random().toString(36).slice(2);
  };

  useEffect(() => {
    if (!canAutocomplete) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = value.trim();
    if (query.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const url =
          `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
          `?input=${encodeURIComponent(query)}` +
          `&types=(cities)` +
          `&language=en` +
          (country ? `&components=country:${country}` : ``) +
          `&sessiontoken=${tokenRef.current}` +
          `&key=${GOOGLE_API_KEY}`;
        const res = await fetch(url);
        const json = await res.json();
        const preds = Array.isArray(json?.predictions) ? json.predictions : [];
        setSuggestions(
          preds.map((p: any) => ({ place_id: p.place_id, description: p.description }))
        );
        setOpen(true);
      } catch {
        // silent fail
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, canAutocomplete, country]);

  const fetchPlace = async (place_id: string) => {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(place_id)}` +
        `&fields=geometry,address_components,formatted_address,name` +
        `&sessiontoken=${tokenRef.current}` +
        `&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const r = json?.result;
      const lat = r?.geometry?.location?.lat;
      const lng = r?.geometry?.location?.lng;

      const comps: any[] = r?.address_components || [];
      const locality = comps.find((c: any) => c.types.includes('locality'))?.long_name;
      const admin1 = comps.find((c: any) => c.types.includes('administrative_area_level_1'))?.short_name;
      const countryCode = comps.find((c: any) => c.types.includes('country'))?.short_name;
      const label =
        [locality, admin1, countryCode].filter(Boolean).join(', ') || r?.name || r?.formatted_address;

      if (typeof lat === 'number' && typeof lng === 'number') {
        onSelect({ name: label, latitude: lat, longitude: lng });
        setOpen(false);
        setSuggestions([]);
        resetSessionToken();
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
      resetSessionToken();
    } catch {
      Alert.alert('Error', 'Could not fetch current location.');
    }
  };

  return (
    <View style={{ position: 'relative' }}>
      <View style={styles.locRow}>
        <TextInput
          value={value}
          onChangeText={(t) => {
            onChangeText(t);
            setOpen(t.trim().length >= MIN_QUERY_LEN);
          }}
          placeholder="City, State"
          placeholderTextColor="#9AA4AF"
          style={[styles.input, { flex: 1 }]}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
        />
        <TouchableOpacity onPress={useCurrentLocation} style={styles.locBtn} accessibilityLabel="Use my current location">
          <Ionicons name="location" size={16} color={DRYNKS_BLUE} />
          <Text style={styles.locBtnText}>Use My Current Location</Text>
        </TouchableOpacity>
      </View>

      {open && (loading || suggestions.length > 0) && (
        <View style={styles.suggestionsWrap}>
          {loading ? (
            <View style={styles.suggestionItem}>
              <ActivityIndicator size="small" color={DRYNKS_BLUE} />
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

      {!GOOGLE_API_KEY && <Text style={{ color: '#9AA4AF', marginTop: 6 }}>Autocomplete disabled (missing EXPO_PUBLIC_GOOGLE_API_KEY)</Text>}
    </View>
  );
};

/* ------------------------------- Main UI ------------------------------- */
const SignupStepTen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { screenname, first_name, phone } = route.params ?? {};

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const profilePhoto = useMemo(() => photos.find((p) => p.role === 'profile') || null, [photos]);
  const gallery = useMemo(() => photos.filter((p) => p.role === 'gallery'), [photos]);

  const [hydrated, setHydrated] = useState(false);
  const [uploadingAny, setUploadingAny] = useState(false);

  // Location
  const [locationText, setLocationText] = useState<string>('');
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });

  // fade-in
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [fadeAnim]);

  // Permissions
  useEffect(() => {
    (async () => {
      try {
        await ImagePicker.requestCameraPermissionsAsync();
      } catch {}
      try {
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      } catch {}
    })();
  }, []);

  // --------- Hydrate from server first, then merge draft ----------
  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id ?? null;
        const em = u?.user?.email ?? null;
        setUserId(uid);
        setEmail(em);

        let serverProfile: string | null = null;
        let serverGallery: string[] = [];
        let serverLocation: string | null = null;
        let serverLat: number | null = null;
        let serverLng: number | null = null;

        if (uid) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('profile_photo, gallery_photos, location, latitude, longitude')
            .eq('id', uid)
            .maybeSingle();

          serverProfile = (prof?.profile_photo ?? null) as any;
          serverGallery = (Array.isArray(prof?.gallery_photos) ? (prof!.gallery_photos as string[]) : []).filter(Boolean);
          serverLocation = (prof?.location ?? null) as any;
          serverLat = typeof prof?.latitude === 'number' ? (prof!.latitude as number) : null;
          serverLng = typeof prof?.longitude === 'number' ? (prof!.longitude as number) : null;
        }

        const draft = await loadDraft().catch(() => null as any);
        const draftProfile = draft?.profile_photo ? String(draft.profile_photo) : null;
        const draftGallery = Array.isArray(draft?.gallery_photos) ? (draft!.gallery_photos as string[]).filter(Boolean) : [];
        const draftLocation = typeof draft?.location === 'string' ? draft.location : null;
        const draftLat = typeof draft?.latitude === 'number' ? draft.latitude : null;
        const draftLng = typeof draft?.longitude === 'number' ? draft.longitude : null;

        // Build initial photo items (server > draft)
        const items: PhotoItem[] = [];
        const pushUnique = (uri: string, role: PhotoItem['role']) => {
          if (!uri) return;
          if (items.some((p) => p.uri === uri)) return;
          items.push({ id: uuidv4(), uri, role, status: isRemote(uri) ? 'remote' : 'local' });
        };

        if (serverProfile) pushUnique(serverProfile, 'profile');
        serverGallery.forEach((g) => pushUnique(g, 'gallery'));

        if (!serverProfile && draftProfile) pushUnique(draftProfile, 'profile');
        if (serverGallery.length === 0 && draftGallery.length) draftGallery.forEach((g) => pushUnique(g, 'gallery'));

        // Ensure exactly one profile role
        if (!items.find((p) => p.role === 'profile') && items.length) {
          items[0].role = 'profile';
        }

        setPhotos(items);

        const chosenLocation = serverLocation || draftLocation || '';
        setLocationText(chosenLocation);
        setCoords({ latitude: serverLat ?? draftLat ?? null, longitude: serverLng ?? draftLng ?? null });
      } catch {
        // ignore
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  /* ------------------------- Autosave (debounced) ------------------------- */
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueAutosave = useCallback(() => {
    if (!hydrated) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        const uid = userId;
        if (!uid) return;
        const profileUrl = profilePhoto?.uri ?? null;
        const galleryUrls = gallery.map((g) => g.uri);

        // Save to server
        await supabase
          .from('profiles')
          .update({
            screenname: route.params?.screenname ?? undefined,
            first_name: route.params?.first_name ?? undefined,
            phone: route.params?.phone ?? undefined,
            profile_photo: profileUrl,
            gallery_photos: galleryUrls,
            location: locationText || null,
            latitude: coords.latitude,
            longitude: coords.longitude,
            current_step: 'ProfileSetupStepTen',
          })
          .eq('id', uid);

        // Save to draft
        await saveDraft({
          profile_photo: profileUrl || undefined,
          gallery_photos: galleryUrls.length ? galleryUrls : undefined,
          location: locationText || undefined,
          latitude: typeof coords.latitude === 'number' ? coords.latitude : undefined,
          longitude: typeof coords.longitude === 'number' ? coords.longitude : undefined,
          step: 'ProfileSetupStepTen',
        });
      } catch (e) {
        // ignore autosave failures silently
      }
    }, 350);
  }, [hydrated, userId, profilePhoto?.uri, gallery, locationText, coords, route.params]);

  useEffect(() => {
    queueAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, locationText, coords]);

  /* -------------------------- Upload management -------------------------- */
  const enhanceImage = async (uri: string): Promise<string> => {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      return result.uri;
    } catch {
      return uri;
    }
  };

  const uploadToSupabase = useCallback(
    async (uri: string, role: 'profile' | 'gallery'): Promise<string | null> => {
      try {
        if (!userId) return null;
        if (isRemote(uri)) return uri;

        const bucket = role === 'profile' ? 'profile-photos' : 'user-photos';
        const filename = `${userId}/${Date.now()}-${uri.split('/').pop() ?? 'image.jpg'}`;
        const contentType = 'image/jpeg';

        const res = await fetch(uri);
        const arrayBuffer = await res.arrayBuffer();

        const { data, error } = await supabase.storage.from(bucket).upload(filename, arrayBuffer, {
          contentType,
          upsert: true,
        });

        if (error || !data) return null;

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
        return urlData?.publicUrl ?? null;
      } catch {
        return null;
      }
    },
    [userId]
  );

  // upload any local items in the background; keep per-item status
  const ensureUploads = useCallback(async () => {
    if (!userId) return;
    const locals = photos.filter((p) => p.status === 'local');
    if (!locals.length) return;

    setUploadingAny(true);
    for (const item of locals) {
      // mark uploading
      setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'uploading' } : p)));
      const remote = await uploadToSupabase(item.uri, item.role);
      if (remote) {
        setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, uri: remote, status: 'remote' } : p)));
      } else {
        setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'failed' } : p)));
      }
    }
    setUploadingAny(false);
    queueAutosave();
  }, [photos, uploadToSupabase, queueAutosave, userId]);

  useEffect(() => {
    if (!hydrated) return;
    ensureUploads().catch(() => {});
  }, [photos, hydrated, ensureUploads]);

  /* ------------------------------ Photo ops ------------------------------ */
  const canAddMore = photos.filter((p) => p.role === 'gallery').length < MAX;

  const addOrReplace = async ({
    role,
    replaceId,
  }: {
    role: 'profile' | 'gallery';
    replaceId?: string;
  }) => {
    try {
      const fromCamera = false;
      const opts = {
        // @ts-ignore
        mediaTypes: MEDIA_IMAGES,
        allowsEditing: true,
        quality: 1,
      } as const;
      const result = await ImagePicker.launchImageLibraryAsync(opts as any);
      if (result.canceled || !result.assets?.length) return;

      const enhanced = await enhanceImage(result.assets[0].uri);
      if (replaceId) {
        setPhotos((prev) => prev.map((p) => (p.id === replaceId ? { ...p, uri: enhanced, status: 'local' } : p)));
      } else if (role === 'profile') {
        // demote existing profile to front of gallery
        setPhotos((prev) => {
          const existing = prev.find((p) => p.role === 'profile');
          const others = prev.filter((p) => p.role === 'gallery');
          const newProfile: PhotoItem = { id: uuidv4(), uri: enhanced, role: 'profile', status: 'local' };
          const demoted = existing ? [{ ...existing, role: 'gallery' as const }] : [];
          return [newProfile, ...demoted, ...others].slice(0, 1 + MAX); // profile + up to MAX gallery
        });
      } else {
        // add to gallery (front)
        setPhotos((prev) => {
          const prof = prev.find((p) => p.role === 'profile');
          const galleryItems = prev.filter((p) => p.role === 'gallery');
          if (galleryItems.length >= MAX) {
            Alert.alert('Limit Reached', `You can only upload ${MAX} gallery photos.`);
            return prev;
          }
          const newItem: PhotoItem = { id: uuidv4(), uri: enhanced, role: 'gallery', status: 'local' };
          return prof ? [prof, newItem, ...galleryItems] : [newItem, ...galleryItems];
        });
      }
    } catch {
      Alert.alert('Error', 'Could not pick image.');
    }
  };

  const replaceAt = (id: string) => addOrReplace({ role: 'gallery', replaceId: id });

  const promoteToProfile = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (!target) return prev;
      const rest = prev.filter((p) => p.id !== id);
      const currentProfile = rest.find((p) => p.role === 'profile');
      const restGallery = rest.filter((p) => p.role === 'gallery');
      const newProfile: PhotoItem = { ...target, role: 'profile' };
      const demoted = currentProfile ? [{ ...currentProfile, role: 'gallery' as const }] : [];
      return [newProfile, ...demoted, ...restGallery].slice(0, 1 + MAX);
    });
  };

  const demoteProfileToGallery = () => {
    setPhotos((prev) => {
      const prof = prev.find((p) => p.role === 'profile');
      const galleryItems = prev.filter((p) => p.role === 'gallery');
      if (!prof) return prev;
      if (galleryItems.length >= MAX) {
        Alert.alert('Gallery full', `Remove a photo first (max ${MAX}).`);
        return prev;
      }
      // Make first gallery (if any) the new profile; otherwise remove profile entirely
      if (galleryItems.length > 0) {
        const [first, ...rest] = galleryItems;
        return [{ ...first, role: 'profile' as const }, { ...prof, role: 'gallery' as const }, ...rest];
      }
      // no gallery to promote
      return [{ ...prof, role: 'gallery' as const }];
    });
  };

  const deletePhoto = (id: string) => {
    setPhotos((prev) => {
      const item = prev.find((p) => p.id === id);
      if (!item) return prev;

      if (item.role === 'profile') {
        // promote first gallery to profile if exists
        const galleryItems = prev.filter((p) => p.role === 'gallery' && p.id !== id);
        if (galleryItems.length) {
          const [first, ...rest] = galleryItems;
          return [{ ...first, role: 'profile' as const }, ...rest];
        }
        return prev.filter((p) => p.id !== id);
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  const movePhoto = (id: string, dir: 'up' | 'down') => {
    setPhotos((prev) => {
      const prof = prev.find((p) => p.role === 'profile');
      const galleryItems = prev.filter((p) => p.role === 'gallery');
      const idx = galleryItems.findIndex((g) => g.id === id);
      if (idx < 0) return prev;

      const j = dir === 'up' ? idx - 1 : idx + 1;
      if (j < 0 || j >= galleryItems.length) return prev;
      [galleryItems[idx], galleryItems[j]] = [galleryItems[j], galleryItems[idx]];
      return prof ? [prof, ...galleryItems] : galleryItems;
    });
  };

  /* ----------------------------- Navigation ----------------------------- */
  const handleBack = async () => {
    try {
      // force one save before leaving
      queueAutosave();
    } finally {
      navigation.goBack();
    }
  };

  const handleFinish = useCallback(async () => {
    const prof = profilePhoto;
    if (!prof) {
      Alert.alert('Missing Profile Photo', 'Upload a profile photo to continue.');
      return;
    }
    if (gallery.length < MIN) {
      Alert.alert('Not Enough Photos', `Please upload at least ${MIN} gallery photos.`);
      return;
    }
    if (photos.some((p) => p.status === 'uploading' || p.status === 'local')) {
      Alert.alert('Please wait', 'Photos are still uploading. We’ll be done in a moment.');
      return;
    }

    try {
      // Final save
      queueAutosave();
      navigation.navigate('ProfileSetupStepEleven' as never, {
        userId,
        screenname,
        first_name,
        phone,
      } as never);
    } catch {
      Alert.alert('Unexpected Error', 'Please try again.');
    }
  }, [profilePhoto, gallery.length, photos, queueAutosave, navigation, userId, screenname, first_name, phone]);

  /* --------------------------------- UI --------------------------------- */
  const canFinish = useMemo(() => !!profilePhoto && gallery.length >= MIN && !uploadingAny, [
    profilePhoto,
    gallery.length,
    uploadingAny,
  ]);

  const renderGalleryItem = ({ item, index }: { item: PhotoItem; index: number }) => {
    const isLastCol = index % numColumns === numColumns - 1;
    return (
      <View style={[styles.gridItem, !isLastCol && { marginRight: colGap }]}>
        <Image source={{ uri: item.uri }} style={styles.gridImage} />

        {/* Upload status overlay */}
        {item.status !== 'remote' && (
          <View style={styles.statusOverlay}>
            {item.status === 'uploading' ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={styles.statusText}>Uploading…</Text>
              </>
            ) : item.status === 'failed' ? (
              <Text style={styles.statusText}>Upload failed</Text>
            ) : (
              <Text style={styles.statusText}>Pending</Text>
            )}
          </View>
        )}

        {/* Actions */}
        <View style={styles.tileActions}>
          <TouchableOpacity onPress={() => promoteToProfile(item.id)} style={styles.pill}>
            <Text style={styles.pillText}>Make Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => replaceAt(item.id)} style={styles.pill}>
            <Text style={styles.pillText}>Replace</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.tileRow}>
          <TouchableOpacity onPress={() => movePhoto(item.id, 'up')} style={styles.pillSm}>
            <Text style={styles.pillSmText}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => movePhoto(item.id, 'down')} style={styles.pillSm}>
            <Text style={styles.pillSmText}>↓</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => deletePhoto(item.id)}
            style={[styles.pillSm, { backgroundColor: '#fee2e2', borderColor: '#fecaca' }]}
          >
            <Text style={[styles.pillSmText, { color: '#b91c1c' }]}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const Header = () => (
    <Animated.View style={[{ opacity: fadeAnim }]}>
      <Text style={styles.header}>Lookin’ Good! 📸</Text>
      <Text style={styles.subtext}>Set your location, upload a profile pic, and 3–10 gallery shots.</Text>

      {/* Location */}
      <Text style={styles.label}>Location</Text>
      <View style={{ zIndex: 1000 }}>
        <LocationAutocomplete
          value={locationText}
          onChangeText={setLocationText}
          onSelect={({ name, latitude, longitude }) => {
            setLocationText(name);
            setCoords({ latitude, longitude });
          }}
          // country="us" // optionally restrict
        />
      </View>

      {/* Profile Photo */}
      <Text style={[styles.label, { marginTop: 14 }]}>Profile Photo</Text>
      {profilePhoto ? (
        <View style={{ alignItems: 'center', marginBottom: 10 }}>
          <Image source={{ uri: profilePhoto.uri }} style={styles.profileImage} />

          {/* Upload state over profile */}
          {profilePhoto.status !== 'remote' && (
            <View style={styles.profileOverlay}>
              {profilePhoto.status === 'uploading' ? (
                <>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.statusText}>Uploading…</Text>
                </>
              ) : profilePhoto.status === 'failed' ? (
                <Text style={styles.statusText}>Upload failed</Text>
              ) : (
                <Text style={styles.statusText}>Pending</Text>
              )}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity onPress={() => addOrReplace({ role: 'profile' })} style={styles.pill}>
              <Text style={styles.pillText}>Replace</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={demoteProfileToGallery} style={styles.pill}>
              <Text style={styles.pillText}>Demote to Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => deletePhoto(profilePhoto.id)}
              style={[styles.pill, { backgroundColor: '#fee2e2', borderColor: '#fecaca' }]}
            >
              <Text style={[styles.pillText, { color: '#b91c1c' }]}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <TouchableOpacity style={styles.uploadBox} onPress={() => addOrReplace({ role: 'profile' })}>
            <Text>Tap to select profile photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, { marginTop: 8 }]}
            onPress={async () => {
              try {
                const opts = {
                  // @ts-ignore
                  mediaTypes: MEDIA_IMAGES,
                  allowsEditing: true,
                  quality: 1,
                } as const;
                const result = await ImagePicker.launchCameraAsync(opts as any);
                if (result.canceled || !result.assets?.length) return;
                const enhanced = await enhanceImage(result.assets[0].uri);
                setPhotos((prev) => {
                  const prof = prev.find((p) => p.role === 'profile');
                  const gal = prev.filter((p) => p.role === 'gallery');
                  const newProfile: PhotoItem = { id: uuidv4(), uri: enhanced, role: 'profile', status: 'local' };
                  const demoted = prof ? [{ ...prof, role: 'gallery' as const }] : [];
                  return [newProfile, ...demoted, ...gal].slice(0, 1 + MAX);
                });
              } catch {
                Alert.alert('Error', 'Could not take photo.');
              }
            }}
          >
            <Text style={styles.pillText}>📷 Take Photo</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Gallery */}
      <Text style={styles.label}>Gallery ({gallery.length}/{MAX})</Text>
    </Animated.View>
  );

  const Footer = () => (
    <View style={{ marginTop: 10 }}>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#232F39' }]}
          onPress={() => {
            if (!canAddMore) {
              Alert.alert('Limit Reached', `You can only upload ${MAX} gallery photos.`);
              return;
            }
            addOrReplace({ role: 'gallery' });
          }}
        >
          <Text style={{ color: DRYNKS_WHITE }}>+ Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: DRYNKS_RED }]}
          onPress={async () => {
            if (!canAddMore) {
              Alert.alert('Limit Reached', `You can only upload ${MAX} gallery photos.`);
              return;
            }
            try {
              const opts = {
                // @ts-ignore
                mediaTypes: MEDIA_IMAGES,
                allowsEditing: true,
                quality: 1,
              } as const;
              const result = await ImagePicker.launchCameraAsync(opts as any);
              if (result.canceled || !result.assets?.length) return;
              const enhanced = await enhanceImage(result.assets[0].uri);
              setPhotos((prev) => {
                const prof = prev.find((p) => p.role === 'profile');
                const gal = prev.filter((p) => p.role === 'gallery');
                const newItem: PhotoItem = { id: uuidv4(), uri: enhanced, role: 'gallery', status: 'local' };
                return prof ? [prof, newItem, ...gal] : [newItem, ...gal];
              });
            } catch {
              Alert.alert('Error', 'Could not take photo.');
            }
          }}
        >
          <Text style={{ color: DRYNKS_WHITE }}>📷 Camera</Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginTop: 24 }}>
        <OnboardingNavButtons
          onBack={handleBack}
          onNext={handleFinish}
          {...({
            nextLabel: uploadingAny ? 'Uploading…' : 'Finish & Continue',
            disabled: !canFinish,
          } as any)}
        />
        {uploadingAny && (
          <View style={{ marginTop: 10, alignItems: 'center' }}>
            <ActivityIndicator />
          </View>
        )}
      </View>
    </View>
  );

  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <FlatList
        data={gallery}
        keyExtractor={(item) => item.id}
        renderItem={renderGalleryItem}
        numColumns={numColumns}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={Header}
        ListFooterComponent={Footer}
        removeClippedSubviews
        initialNumToRender={9}
        windowSize={11}
        keyboardShouldPersistTaps="handled"
      />
    </AnimatedScreenWrapper>
  );
};

/* --------------------------------- Styles -------------------------------- */
const styles = StyleSheet.create({
  listContent: { padding: horizontalPadding, paddingBottom: 24, backgroundColor: DRYNKS_WHITE },

  header: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8, color: DRYNKS_BLUE },
  subtext: { fontSize: 14, color: DRYNKS_BLUE, textAlign: 'center', marginBottom: 16 },
  label: { fontWeight: '600', marginVertical: 10, color: '#23303A' },

  // Location UI
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    color: '#111827',
  },
  locBtn: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locBtnText: { color: DRYNKS_BLUE, fontWeight: '600' },
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

  // Profile
  profileImage: { width: 140, height: 140, borderRadius: 16, marginBottom: 4, backgroundColor: '#eee' },
  profileOverlay: {
    position: 'absolute',
    top: 0,
    left: (140 - 140) / 2,
    width: 140,
    height: 140,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  uploadBox: {
    width: 160,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#eee',
    marginBottom: 10,
  },

  // Gallery grid & tile
  gridItem: {
    width: itemSize,
    height: itemSize,
    marginBottom: colGap,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#eee',
  },
  gridImage: { width: '100%', height: '100%' },
  statusOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: { color: '#fff', marginTop: 6, fontWeight: '700' },

  tileActions: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 34,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tileRow: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  // Pills
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  pillText: { color: '#111827', fontWeight: '600' },

  pillSm: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  pillSmText: { color: '#111827', fontWeight: '700' },

  // Footer actions
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 5,
  },
});

export default SignupStepTen;
