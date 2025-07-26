import React, { useState, useEffect } from 'react';
import {
  View, TextInput, FlatList, TouchableOpacity, Text, StyleSheet
} from 'react-native';
import Constants from 'expo-constants';
import * as Location from 'expo-location';

const GOOGLE_API_KEY = Constants.expoConfig?.extra?.GOOGLE_API_KEY;
console.log('🔑 Google API Key:', GOOGLE_API_KEY);

interface Props {
  value?: string;
  onLocationSelect: (args: {
    name: string;
    latitude: number;
    longitude: number;
  }) => void;
}

const CustomLocationInput: React.FC<Props> = ({ onLocationSelect, value }) => {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState<any[]>([]);

  useEffect(() => {
    console.log('📦 CustomLocationInput mounted');
  }, []);

  const fetchPlaces = async (text: string) => {
    setQuery(text);
    if (text.length < 2) return;

    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
      text
    )}&types=(cities)&key=${GOOGLE_API_KEY}`;

    try {
      const res = await fetch(url);
      const json = await res.json();
      console.log('[GOOGLE PLACES]', json.status);
      if (json.status === 'OK') {
        setResults(json.predictions || []);
      } else {
        console.warn('❌ Google API error:', json.status, json.error_message);
      }
    } catch (e) {
      console.warn('❌ Autocomplete fetch failed', e);
    }
  };

  const handleSelect = async (item: any) => {
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${item.place_id}&key=${GOOGLE_API_KEY}`;

    try {
      const res = await fetch(detailUrl);
      const json = await res.json();
      const location = json.result.geometry.location;

      setQuery(item.description);
      setResults([]);
      onLocationSelect({
        name: item.description,
        latitude: location.lat,
        longitude: location.lng,
      });
    } catch (e) {
      console.warn('❌ Place detail fetch failed', e);
    }
  };

  const handleUseMyLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        alert('Location permission denied');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const geo = await Location.reverseGeocodeAsync(loc.coords);
      const city = geo?.[0]?.city || geo?.[0]?.region || 'Current Location';

      setQuery(city);
      setResults([]);
      onLocationSelect({
        name: city,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch (e) {
      console.warn('❌ Use My Location error', e);
    }
  };

  return (
    <View style={styles.wrapper}>
      <TextInput
        style={styles.input}
        placeholder="Enter your city"
        value={query}
        onChangeText={fetchPlaces}
        autoCorrect={false}
        onFocus={() => {
          if (query.length >= 2) fetchPlaces(query);
        }}
      />
      {results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.place_id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.item} onPress={() => handleSelect(item)}>
              <Text>{item.description}</Text>
            </TouchableOpacity>
          )}
          style={styles.dropdown}
        />
      )}
      <TouchableOpacity onPress={handleUseMyLocation} style={styles.locationBtn}>
        <Text style={styles.locationText}>📍 Use My Current Location</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 12,
    zIndex: 999,
  },
  input: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  dropdown: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 150,
  },
  item: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  locationBtn: {
    padding: 12,
    marginTop: 8,
  },
  locationText: {
    color: '#232F39',
    fontWeight: '600',
  },
});

export default CustomLocationInput;
