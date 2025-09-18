// src/screens/Onboarding/SignupStepNine.tsx
// Step 9 — Location (server-first hydrate, draft cache, Places autocomplete + geocoding)

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  FlatList,
} from 'react-native';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';
import { v4 as uuidv4 } from 'uuid';
import { loadDraft, saveDraft } from '@utils/onboardingDraft';

// ---- Brand colors (ONE source of truth) ----
const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#F1F4F7';
const DRYNKS_WHITE = '#FFFFFF';

const popularCities = [
  'Los Angeles', 'Miami', 'Boston', 'New York', 'Philadelphia',
  'San Jose', 'San Francisco', 'San Diego', 'Las Vegas',
  'Chicago', 'Dallas', 'Austin', 'Atlanta',
];

// Try EXPO_PUBLIC_ first (Expo best practice), then plain env as fallback
const GOOGLE_KEY =
  (process.env as any)?.EXPO_PUBLIC_GOOGLE_API_KEY ||
  (process.env as any)?.GOOGLE_API_KEY ||
  '';

const COUNTRIES: string[] = String(
  (process.env as any)?.EXPO_PUBLIC_PLACES_COUNTRIES || 'us,ca'
)
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

type Suggestion = {
  description: string;
  place_id: string;
};

const AUTOCOMPLETE_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/details/json';

// Small utility: debounce via setTimeout
function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// Heuristic to keep "city-like" predictions when we must query without types
function isCityPrediction(p: any): boolean {
  const t: string[] = Array.isArray(p?.types) ? p.types : [];
  if (t.includes('locality')) return true;
  if (t.includes('administrative_area_level_3') || t.includes('administrative_area_level_2')) return true;
  // Fallback: descriptions with "City, State/Region"
  const commas = String(p?.description || '').split(',').length - 1;
  return commas >= 1 && !t.includes('establishment');
}

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
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);

  // Autocomplete state
  const [sessionToken] = useState<string>(uuidv4()); // one per screen/session (recommended)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(false);
  const debouncedQuery = useDebouncedValue(locationName, 300);
  const hasPlaces = useMemo(() => !!GOOGLE_KEY, []);
  const scrollRef = useRef<ScrollView | null>(null);

  // ---------- Hydrate from server first, then local draft ----------
  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id || null;
        const email = u?.user?.email || null;
        if (uid && email) setMe({ id: uid, email });

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

  // ---------- Suggestion search (3+ characters) ----------
  useEffect(() => {
    const q = debouncedQuery?.trim();
    if (!hasPlaces) {
      // Fallback: simple prefix match against popular cities (still shows a dropdown)
      if (q && q.length >= 3) {
        const matches = popularCities
          .filter((c) => c.toLowerCase().startsWith(q.toLowerCase()))
          .slice(0, 6)
          .map((c, i) => ({ description: c, place_id: `local-${i}-${c}` }));
        setSuggestions(matches);
        setOpenDropdown(matches.length > 0);
      } else {
        setSuggestions([]);
        setOpenDropdown(false);
      }
      return;
    }

    if (!q || q.length < 3) {
      setSuggestions([]);
      setOpenDropdown(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoadingSuggest(true);

        const components =
          COUNTRIES.length > 0 ? `&components=${COUNTRIES.map((c) => `country:${c}`).join('|')}` : '';
        const common = `input=${encodeURIComponent(q)}&language=en&key=${GOOGLE_KEY}&sessiontoken=${sessionToken}&locationbias=ipbias${components}`;

        // Try with types=(cities) first
        let url = `${AUTOCOMPLETE_ENDPOINT}?${common}&types=(cities)`;
        let res = await fetch(url);
        let json = await res.json();

        let items: Suggestion[] = [];
        if (json?.status === 'OK' && Array.isArray(json?.predictions) && json.predictions.length) {
          items = json.predictions.map((p: any) => ({
            description: p.description,
            place_id: p.place_id,
          }));
        } else {
          // Fallback: retry without types, then filter to city-like predictions
          url = `${AUTOCOMPLETE_ENDPOINT}?${common}`;
          res = await fetch(url);
          json = await res.json();
          if (json?.status === 'OK' && Array.isArray(json?.predictions)) {
            const filtered = json.predictions.filter(isCityPrediction);
            items = filtered.map((p: any) => ({
              description: p.description,
              place_id: p.place_id,
            }));
          }
        }

        if (cancelled) return;

        if (items.length > 0) {
          setSuggestions(items);
          setOpenDropdown(true);
        } else {
          // As a final UX nicety, show populars matching the prefix
          const matches = popularCities
            .filter((c) => c.toLowerCase().startsWith(q.toLowerCase()))
            .slice(0, 6)
            .map((c, i) => ({ description: c, place_id: `local-${i}-${c}` }));
          setSuggestions(matches);
          setOpenDropdown(matches.length > 0);
        }
      } catch (e) {
        // Network/key issues: fallback to local matches
        const matches = popularCities
          .filter((c) => c.toLowerCase().startsWith(q!.toLowerCase()))
          .slice(0, 6)
          .map((c, i) => ({ description: c, place_id: `local-${i}-${c}` }));
        setSuggestions(matches);
        setOpenDropdown(matches.length > 0);
      } finally {
        if (!cancelled) setLoadingSuggest(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, sessionToken, hasPlaces]);

  const handleUseCurrentLocation = async () => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        Alert.alert('Permission needed', 'Please enable Location permission in Settings.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = loc.coords;
      const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
      const city = geo?.[0]?.city || geo?.[0]?.subregion || geo?.[0]?.region || '';

      setLocationName(city);
      setCoords({ latitude, longitude });
      setOpenDropdown(false);
      setSuggestions([]);
    } catch (err) {
      Alert.alert('Location Error', 'Could not fetch current location.');
    }
  };

  const geocodeCityFallback = async (city: string) => {
    try {
      const results = await Location.geocodeAsync(city);
      if (results?.length) {
        setCoords({
          latitude: results[0].latitude,
          longitude: results[0].longitude,
        });
      }
    } catch {
      // ignore; user can still proceed with just the name
    }
  };

  const resolvePlaceDetails = async (place_id: string, nameFromSuggestion?: string) => {
    if (!hasPlaces || place_id.startsWith('local-')) {
      if (nameFromSuggestion) await geocodeCityFallback(nameFromSuggestion);
      return;
    }
    try {
      const url = `${DETAILS_ENDPOINT}?place_id=${encodeURIComponent(
        place_id
      )}&fields=geometry,name&key=${GOOGLE_KEY}&sessiontoken=${sessionToken}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json?.status === 'OK' && json?.result?.geometry?.location) {
        const { lat, lng } = json.result.geometry.location;
        setCoords({ latitude: lat, longitude: lng });
      } else if (nameFromSuggestion) {
        await geocodeCityFallback(nameFromSuggestion);
      }
    } catch {
      if (nameFromSuggestion) await geocodeCityFallback(nameFromSuggestion);
    }
  };

  const handleSuggestionPress = async (s: Suggestion) => {
    setLocationName(s.description);
    setOpenDropdown(false);
    setSuggestions([]);
    await resolvePlaceDetails(s.place_id, s.description);
    setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 150);
  };

  const handleCityPress = async (city: string) => {
    setLocationName(city);
    setOpenDropdown(false);
    setSuggestions([]);
    if (hasPlaces) {
      try {
        const comps =
          COUNTRIES.length > 0 ? `&components=${COUNTRIES.map((c) => `country:${c}`).join('|')}` : '';
        const url = `${AUTOCOMPLETE_ENDPOINT}?input=${encodeURIComponent(
          city
        )}&key=${GOOGLE_KEY}&sessiontoken=${sessionToken}${comps}&language=en&locationbias=ipbias`;
        const res = await fetch(url);
        const json = await res.json();
        const pid = json?.predictions?.[0]?.place_id;
        if (pid) {
          await resolvePlaceDetails(pid, city);
          return;
        }
      } catch {
        // fall through
      }
    }
    await geocodeCityFallback(city);
  };

  // ---------- Back / Next ----------
  const handleBack = async () => {
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

  const ensureCoordsIfMissing = async () => {
    if (locationName && (coords.latitude == null || coords.longitude == null)) {
      // last try: geocode the typed city
      try {
        const results = await Location.geocodeAsync(locationName);
        if (results?.length) {
          setCoords({ latitude: results[0].latitude, longitude: results[0].longitude });
          return { latitude: results[0].latitude, longitude: results[0].longitude };
        }
      } catch {}
    }
    return coords;
  };

  const handleNext = async () => {
    if (!screenname || !first_name || !phone) {
      Alert.alert(
        'Missing Info',
        'Your signup session is incomplete. Please restart the signup process.'
      );
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

      // UPDATE is safer than upsert here (row should already exist)
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          screenname,
          first_name,
          phone,
          location: locationName,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          current_step: 'ProfileSetupStepTen', // advance to Step 10 (Photos)
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

      navigation.navigate('ProfileSetupStepTen' as never, {
        screenname,
        first_name,
        phone,
      } as never);
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
        <TouchableWithoutFeedback
          onPress={() => {
            setOpenDropdown(false);
            Keyboard.dismiss();
          }}
        >
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
              We’ve auto‑filled your location, but feel free to change it or pick from our party hot list.
            </Text>

            <View style={{ position: 'relative' }}>
              <TextInput
                style={styles.input}
                placeholder="Enter your city"
                value={locationName}
                onChangeText={(t) => {
                  setLocationName(t);
                  // Reset coords while typing; they’ll be set when a suggestion is chosen
                  setCoords({ latitude: null, longitude: null });
                  // If 3+ chars, open dropdown immediately for better UX
                  setOpenDropdown(t.trim().length >= 3);
                }}
                placeholderTextColor="#8A94A6"
                onFocus={() => {
                  if (suggestions.length > 0 || loadingSuggest) setOpenDropdown(true);
                }}
              />

              {/* Autocomplete dropdown */}
              {openDropdown && (
                <View style={styles.dropdown}>
                  {loadingSuggest ? (
                    <View style={styles.dropdownItem}>
                      <ActivityIndicator />
                      <Text style={{ marginLeft: 8, color: '#6b7280' }}>Searching cities…</Text>
                    </View>
                  ) : suggestions.length === 0 ? (
                    <View style={styles.dropdownItem}>
                      <Text style={{ color: '#6b7280' }}>No matches</Text>
                    </View>
                  ) : (
                    <>
                      <FlatList
                        keyboardShouldPersistTaps="handled"
                        data={suggestions}
                        keyExtractor={(item) => item.place_id}
                        renderItem={({ item }) => (
                          <TouchableOpacity
                            style={styles.dropdownItem}
                            activeOpacity={0.8}
                            onPress={() => handleSuggestionPress(item)}
                          >
                            <Text style={{ color: '#111827' }}>{item.description}</Text>
                          </TouchableOpacity>
                        )}
                        ItemSeparatorComponent={() => <View style={styles.separator} />}
                      />
                      {/* "Powered by Google" attribution per Places terms */}
                      {hasPlaces && (
                        <View style={styles.poweredBy}>
                          <Text style={styles.poweredText}>Powered by Google</Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}
            </View>

            <TouchableOpacity onPress={handleUseCurrentLocation} style={{ marginVertical: 10 }}>
              <Text style={{ color: DRYNKS_BLUE, fontWeight: '600' }}>📍 Use My Current Location</Text>
            </TouchableOpacity>

            <View style={styles.cityGrid}>
              {popularCities.map((city) => (
                <TouchableOpacity
                  key={city}
                  style={[styles.cityButton, locationName === city && styles.cityButtonSelected]}
                  onPress={() => handleCityPress(city)}
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
                onBack={handleBack}
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
    marginBottom: 20,
  },
  input: {
    height: 50,
    borderColor: '#DADFE6',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    fontSize: 16,
    backgroundColor: DRYNKS_GRAY,
    color: '#1F2A33',
  },
  dropdown: {
    position: 'absolute',
    top: 54,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    zIndex: 1000,
    maxHeight: 260,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
  },
  separator: { height: 1, backgroundColor: '#F3F4F6' },
  poweredBy: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingVertical: 6,
    alignItems: 'flex-end',
    paddingRight: 10,
    backgroundColor: '#fff',
  },
  poweredText: { fontSize: 10, color: '#9CA3AF' },
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
  cityButtonSelected: {
    backgroundColor: DRYNKS_RED,
    borderColor: DRYNKS_RED,
  },
  cityButtonText: {
    fontSize: 14,
    color: '#23303A',
  },
  cityButtonTextSelected: {
    color: DRYNKS_WHITE,
    fontWeight: '700',
  },
});

export default SignupStepNine;
