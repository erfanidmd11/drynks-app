// Step 9 — Location (server-first hydrate, draft cache)
// Autocomplete rendered in a top-level Modal portal (cannot be clipped by parents)

import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  ActivityIndicator,
  Modal,
  Dimensions,
} from 'react-native';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { v4 as uuidv4 } from 'uuid';
import { Ionicons } from '@expo/vector-icons';

import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';
import { supabase } from '@config/supabase';
import { loadDraft, saveDraft } from '@utils/onboardingDraft';
import { GOOGLE_PLACES_KEY as GOOGLE_KEY, HAS_PLACES, PLACES_COUNTRIES } from '@config/env';

// ---- Brand colors ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';
const PLACEHOLDER = '#4B5563';

// Convenience quick‑picks (UX only; does NOT restrict global search)
const popularCities = [
  'Los Angeles', 'Miami', 'Boston', 'New York', 'Philadelphia',
  'San Jose', 'San Francisco', 'San Diego', 'Las Vegas',
  'Chicago', 'Dallas', 'Austin', 'Atlantic City',
];

// ---------- Autocomplete helpers (same as Create Date) ----------
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

/** Portal-based autocomplete to avoid zIndex/overflow clipping. */
const LocationAutocomplete: React.FC<{
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (sel: PlaceSelection) => void;
}> = ({ value, onChangeText, onSelect }) => {
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<string>(uuidv4());
  const screen = Dimensions.get('window');

  const canAutocomplete = HAS_PLACES;
  const resetSession = () => { sessionRef.current = uuidv4(); };

  const measure = useCallback(() => {
    // Run twice to dodge initial 0,0 on some Android layouts
    requestAnimationFrame(() => {
      inputRef.current?.measureInWindow?.((x, y, w, h) => {
        if (w && h) {
          setAnchor({ x, y, w, h });
        } else {
          setTimeout(() => {
            inputRef.current?.measureInWindow?.((x2, y2, w2, h2) => {
              if (w2 && h2) setAnchor({ x: x2, y: y2, w: w2, h: h2 });
            });
          }, 50);
        }
      });
    });
  }, []);

  useEffect(() => {
    if (open) measure();
  }, [open, measure, value]);

  useEffect(() => {
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
        PLACES_COUNTRIES.length > 0 ? `&components=${PLACES_COUNTRIES.map((c) => `country:${c}`).join('|')}` : '';
      const common =
        `input=${encodeURIComponent(query)}&language=en&key=${GOOGLE_KEY}` +
        `&sessiontoken=${sessiontoken}&locationbias=ipbias${components}`;

      try {
        setLoading(true);

        // A) Autocomplete with cities
        let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${common}&types=(cities)`;
        let res = await fetch(url);
        let json = await res.json();

        if (__DEV__ && json?.status !== 'OK') {
          console.warn('[Places A] status:', json?.status, json?.error_message);
        }

        if (json?.status === 'OK' && Array.isArray(json?.predictions) && json.predictions.length) {
          const items = json.predictions.map((p: any) => ({ place_id: p.place_id, description: p.description }));
          setSuggestions(items);
          setOpen(items.length > 0);
          return;
        }

        // A2) Regions (some accounts return better city-like hits here)
        url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${common}&types=(regions)`;
        res = await fetch(url);
        json = await res.json();

        if (json?.status === 'OK' && Array.isArray(json?.predictions) && json.predictions.length) {
          const filtered = json.predictions.filter(isCityPrediction);
          const items = filtered.map((p: any) => ({ place_id: p.place_id, description: p.description }));
          if (items.length) {
            setSuggestions(items);
            setOpen(true);
            return;
          }
        }

        // B) General autocomplete, filter to cities
        url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${common}`;
        res = await fetch(url);
        json = await res.json();

        if (__DEV__ && json?.status !== 'OK') {
          console.warn('[Places B] status:', json?.status, json?.error_message);
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
          `&key=${GOOGLE_KEY}` +
          `&sessiontoken=${sessiontoken}`;
        res = await fetch(url);
        json = await res.json();

        if (__DEV__ && json?.status !== 'OK') {
          console.warn('[Places C - FindPlace] status:', json?.status, json?.error_message);
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
          `&key=${GOOGLE_KEY}`;
        res = await fetch(url);
        json = await res.json();

        if (__DEV__ && json?.status !== 'OK') {
          console.warn('[Places D - Geocode] status:', json?.status, json?.error_message);
        }

        if (json?.status === 'OK' && Array.isArray(json?.results) && json.results.length) {
          const r = json.results[0];
          const label = labelFromAddressComponents(r);
          const loc = r.geometry?.location;
          if (label && loc?.lat != null && loc?.lng != null) {
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
        `&key=${GOOGLE_KEY}`;
      const res = await fetch(url);
      const json = await res.json();

      if (__DEV__ && json?.status !== 'OK') {
        console.warn('[Places Details] status:', json?.status, json?.error_message);
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
      if (__DEV__ && e) console.warn('[Places Details ERROR]', e);
    }
  };

  return (
    <>
      <TextInput
        ref={inputRef}
        value={value}
        onLayout={measure}
        onChangeText={(t) => {
          onChangeText(t);
          if (t.trim().length >= MIN_QUERY_LEN) setOpen(true);
          if (t.trim().length === 0) {
            setSuggestions([]);
            setOpen(false);
          }
        }}
        placeholder="Enter your city (e.g., Seattle)"
        placeholderTextColor={PLACEHOLDER}
        style={styles.input}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onFocus={() => {
          measure();
          if (suggestions.length > 0) setOpen(true);
        }}
      />

      {/* Own line: Use current location */}
      <TouchableOpacity
        onPress={async () => {
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
        }}
        style={styles.locFullBtn}
        accessibilityLabel="Choose My Current Location"
        activeOpacity={0.9}
      >
        <Ionicons name="location" size={16} color={DRYNKS_BLUE} />
        <Text style={styles.locBtnText}>Choose My Current Location</Text>
      </TouchableOpacity>

      {/* PORTAL: anchored dropdown in a transparent Modal */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* click anywhere to close */}
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        {/* If measure isn't ready yet, show a safe fallback box below the notch */}
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View
            style={[
              styles.portalBox,
              anchor && anchor.w && anchor.h
                ? {
                    top: Math.min(anchor.y + anchor.h + 4, screen.height - 320),
                    left: Math.max(8, anchor.x),
                    width: Math.max(260, Math.min(screen.width - 16, anchor.w)),
                  }
                : {
                    top: Math.max(insets.top + 96, 96),
                    left: 12,
                    width: screen.width - 24,
                  },
            ]}
          >
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
                {HAS_PLACES && (
                  <View style={styles.poweredBy}>
                    <Text style={styles.poweredText}>Powered by Google</Text>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {!HAS_PLACES && (
        <Text style={{ color: '#9AA4AF', marginTop: 6 }}>
          Autocomplete disabled (missing EXPO_PUBLIC_GOOGLE_API_KEY)
        </Text>
      )}
    </>
  );
};

// ---------- Screen ----------
const SignupStepNine: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { screenname, first_name, phone } = route.params ?? {};

  const [locationName, setLocationName] = useState('');
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  // ---------- Hydrate from server first, then local draft ----------
  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id || null;
        if (uid) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('location, latitude, longitude')
            .eq('id', uid)
            .maybeSingle();

          if (prof?.location) setLocationName(String(prof.location));
          if (prof?.latitude != null && prof?.longitude != null) {
            setCoords({ latitude: Number(prof.latitude), longitude: Number(prof.longitude) });
          }
        }

        // merge local draft if server didn’t have values
        const draft = await loadDraft();
        if (!locationName && draft?.location) setLocationName(String(draft.location));
        if ((coords.latitude == null || coords.longitude == null) && draft) {
          if (draft.latitude != null && draft.longitude != null) {
            setCoords({ latitude: draft.latitude, longitude: draft.longitude });
          }
        }
      } catch {
        // ignore
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Persist draft on change ----------
  useEffect(() => {
    if (!hydrated) return;
    saveDraft({
      location: locationName || undefined,
      latitude: coords.latitude ?? undefined,
      longitude: coords.longitude ?? undefined,
      step: 'ProfileSetupStepNine',
    }).catch(() => {});
  }, [locationName, coords, hydrated]);

  const handleUseCurrentLocation = async () => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        Alert.alert('Permission needed', 'Please enable Location permission in Settings.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
      const city = geo?.[0]?.city || geo?.[0]?.subregion || geo?.[0]?.region || '';

      setLocationName(city);
      setCoords({ latitude, longitude });
      Keyboard.dismiss();
    } catch {
      Alert.alert('Location Error', 'Could not fetch current location.');
    }
  };

  const handleCityQuickPick = async (city: string) => {
    // Quick-pick tiles still resolve globally (Places or device geocoder)
    try {
      setLocationName(city);
      if (HAS_PLACES) {
        const comps =
          PLACES_COUNTRIES.length > 0 ? `&components=${PLACES_COUNTRIES.map((c) => `country:${c}`).join('|')}` : '';
        const url =
          `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
          `?input=${encodeURIComponent(city)}` +
          `&key=${GOOGLE_KEY}&sessiontoken=${uuidv4()}${comps}&language=en&locationbias=ipbias`;
        const res = await fetch(url);
        const json = await res.json();
        const pid = json?.predictions?.[0]?.place_id;
        if (pid) {
          const det =
            `https://maps.googleapis.com/maps/api/place/details/json` +
            `?place_id=${encodeURIComponent(pid)}` +
            `&fields=geometry,address_components,formatted_address,name` +
            `&key=${GOOGLE_KEY}`;
          const dres = await fetch(det);
          const djson = await dres.json();
          const { lat, lng } = djson?.result?.geometry?.location ?? {};
          if (typeof lat === 'number' && typeof lng === 'number') {
            setCoords({ latitude: lat, longitude: lng });
            return;
          }
        }
      }
      // Device geocoder fallback
      const results = await Location.geocodeAsync(city);
      if (results?.length) {
        setCoords({ latitude: results[0].latitude, longitude: results[0].longitude });
      }
    } catch {
      // Non-blocking
    }
  };

  const ensureCoordsIfMissing = async () => {
    if (locationName && (coords.latitude == null || coords.longitude == null)) {
      try {
        const results = await Location.geocodeAsync(locationName);
        if (results?.length) {
          const c = { latitude: results[0].latitude, longitude: results[0].longitude };
          setCoords(c);
          return c;
        }
      } catch {}
    }
    return coords;
  };

  // ---------- Back / Next ----------
  const navigationBack = async () => {
    try {
      await saveDraft({
        location: locationName || undefined,
        latitude: coords.latitude ?? undefined,
        longitude: coords.longitude ?? undefined,
        step: 'ProfileSetupStepEight',
      });

      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id || null;
      if (uid) {
        await supabase
          .from('profiles')
          .update({
            location: locationName || null,
            latitude: coords.latitude ?? null,
            longitude: coords.longitude ?? null,
            current_step: 'ProfileSetupStepEight',
          })
          .eq('id', uid);
      }
    } catch {}
    navigation.goBack();
  };

  const handleNext = async () => {
    if (!screenname || !first_name || !phone) {
      Alert.alert('Missing Info', 'Your signup session is incomplete. Please restart the signup process.');
      navigation.navigate('ProfileSetupStepOne' as never);
      return;
    }
    if (!locationName) {
      Alert.alert('Where You At?', 'Please select or enter your city.');
      return;
    }

    try {
      const ensured = await ensureCoordsIfMissing();
      const { latitude, longitude } = ensured;

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.id || !userData.user.email) {
        Alert.alert('Error', 'User authentication failed.');
        return;
      }
      const { user } = userData;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          screenname,
          first_name,
          phone,
          location: locationName,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          current_step: 'ProfileSetupStepTen',
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('[Supabase Update Error]', updateError);
        Alert.alert('Error', 'Could not save your location.');
        return;
      }

      await saveDraft({
        location: locationName,
        latitude: latitude ?? undefined,
        longitude: longitude ?? undefined,
        step: 'ProfileSetupStepTen',
      });

      navigation.navigate('ProfileSetupStepTen' as never, { screenname, first_name, phone } as never);
    } catch (err) {
      console.error('[Step9 Next Error]', err);
      Alert.alert('Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  // ---------- UI ----------
  return (
    <AnimatedScreenWrapper {...({ style: { backgroundColor: DRYNKS_WHITE } } as any)}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Math.max(0, insets.top + 64)}
      >
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); }}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="always"
          >
            <Text style={styles.header}>
              {screenname ? `Where You Chillin’, @${screenname}? 📍` : 'Where You Chillin’? 📍'}
            </Text>
            <Text style={styles.subtext}>
              Type your city and pick a suggestion. You can also use your current location.
            </Text>

            {/* Autocomplete (Portal-based) */}
            <LocationAutocomplete
              value={locationName}
              onChangeText={(t) => {
                setLocationName(t);
                setCoords({ latitude: null, longitude: null }); // reset until selection
              }}
              onSelect={({ name, latitude, longitude }) => {
                setLocationName(name);
                setCoords({ latitude, longitude });
                setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 150);
              }}
            />

            {/* Current location (secondary button for visibility) */}
            <TouchableOpacity onPress={handleUseCurrentLocation} style={{ marginVertical: 10 }}>
              <Text style={{ color: DRYNKS_BLUE, fontWeight: '600' }}>📍 Use My Current Location</Text>
            </TouchableOpacity>

            {/* Convenience tiles (do not restrict global search) */}
            <View style={styles.cityGrid}>
              {popularCities.map((city) => (
                <TouchableOpacity
                  key={city}
                  style={[styles.cityButton, locationName === city && styles.cityButtonSelected]}
                  onPress={() => handleCityQuickPick(city)}
                >
                  <Text
                    style={[
                      styles.cityButtonText,
                      locationName === city && styles.cityButtonTextSelected,
                    ]}
                  >
                    {city}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 30 }}>
              <OnboardingNavButtons
                onBack={navigationBack}
                onNext={handleNext}
                {...({ disabled: !locationName } as any)}
              />
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
    backgroundColor: DRYNKS_WHITE,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
    color: DRYNKS_BLUE,
  },
  subtext: {
    fontSize: 14,
    color: '#55606B',
    textAlign: 'center',
    marginBottom: 16,
  },

  // Input (inside LocationAutocomplete)
  input: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },

  // LocationAutocomplete portal styles (Modal content)
  portalBox: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 4,
    maxHeight: 300,
    // shadow
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 12,
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

  // Quick picks
  cityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  cityButton: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    backgroundColor: '#EEF2F6',
    borderRadius: 20,
    margin: 5,
    borderColor: '#DADFE6',
    borderWidth: 1,
  },
  cityButtonSelected: { backgroundColor: DRYNKS_RED, borderColor: DRYNKS_RED },
  cityButtonText: { fontSize: 14, color: '#23303A' },
  cityButtonTextSelected: { color: DRYNKS_WHITE, fontWeight: '700' },

  // Current location button (inside autocomplete)
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
});

export default SignupStepNine;
