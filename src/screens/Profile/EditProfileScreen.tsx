// EditProfileScreen.tsx – Profile Editing with LocationInput Integration
import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@config/supabase';
import { useNavigation } from '@react-navigation/native';
import CustomLocationInput from '@components/CustomLocationInput';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';
const { width } = Dimensions.get('window');

const EditProfileScreen = () => {
  const navigation = useNavigation();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screenName, setScreenName] = useState('');
  const [about, setAbout] = useState('');
  const [gallery, setGallery] = useState([]);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState({ latitude: null, longitude: null });

  useEffect(() => {
    const loadProfile = async () => {
      const { data: session } = await supabase.auth.getSession();
      const user = session?.session?.user;
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data) {
        setProfile(data);
        setScreenName(data.screen_name);
        setAbout(data.about || '');
        setAvatarUrl(data.avatar_url);
        setGallery(data.gallery_photos || []);
        setLocation(data.location || '');
        setCoords({ latitude: data.latitude, longitude: data.longitude });
      }
      setLoading(false);
    };
    loadProfile();
  }, []);

  const pickImage = async (isAvatar = false) => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      if (isAvatar) setAvatarUrl(uri);
      else setGallery([...gallery, uri]);
    }
  };

  const removePhoto = (uri) => {
    if (gallery.length <= 3) {
      Alert.alert('Minimum 3 photos required', 'You must have at least 3 gallery photos.');
      return;
    }
    setGallery(gallery.filter(img => img !== uri));
  };

  const saveProfile = async () => {
    if (!avatarUrl || gallery.length < 3) {
      Alert.alert('Incomplete Profile', 'Profile photo and at least 3 gallery photos are required.');
      return;
    }
    setLoading(true);
    const updates = {
      screen_name: screenName,
      about,
      avatar_url: avatarUrl,
      gallery_photos: gallery,
      location,
      latitude: coords.latitude,
      longitude: coords.longitude,
    };
    const { error } = await supabase.from('profiles').update(updates).eq('id', profile.id);
    if (!error) {
      Alert.alert('Saved', 'Profile updated successfully.');
      navigation.goBack();
    } else {
      Alert.alert('Error', 'Could not update profile.');
    }
    setLoading(false);
  };

  if (loading) return <ActivityIndicator size="large" color={DRYNKS_RED} style={{ flex: 1 }} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Screen Name</Text>
      <TextInput style={styles.input} value={screenName} onChangeText={setScreenName} />

      <Text style={styles.label}>About</Text>
      <TextInput
        style={[styles.input, { height: 80 }]}
        multiline
        numberOfLines={4}
        value={about}
        onChangeText={setAbout}
      />

      <Text style={styles.label}>Location</Text>
      <CustomLocationInput onLocationSelect={({ name, latitude, longitude }) => {
        setOverrideCoords({ lat: latitude, lng: longitude });
        setLocation(name);
        setCoords({ latitude, longitude });
      }} />

      <Text style={styles.label}>Profile Photo</Text>
      <TouchableOpacity onPress={() => pickImage(true)}>
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      </TouchableOpacity>

      <Text style={styles.label}>Gallery Photos (min 3)</Text>
      <FlatList
        data={gallery}
        keyExtractor={(item, i) => `${item}-${i}`}
        horizontal
        renderItem={({ item }) => (
          <TouchableOpacity onLongPress={() => removePhoto(item)}>
            <Image source={{ uri: item }} style={styles.galleryPhoto} />
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={styles.addButton} onPress={() => pickImage(false)}>
        <Text style={styles.addText}>+ Add More Photos</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={saveProfile} style={styles.saveButton}>
        <Text style={styles.saveText}>💾 Save Changes</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20 },
  label: { fontSize: 14, fontWeight: '600', color: DRYNKS_BLUE, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    backgroundColor: '#fff',
  },
  avatar: { width: 100, height: 100, borderRadius: 50, marginTop: 10 },
  galleryPhoto: {
    width: 90,
    height: 90,
    borderRadius: 12,
    marginRight: 8,
    marginTop: 10,
  },
  addButton: {
    marginTop: 12,
    backgroundColor: DRYNKS_BLUE,
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  addText: { color: '#fff', fontWeight: '600' },
  saveButton: {
    backgroundColor: DRYNKS_RED,
    padding: 14,
    borderRadius: 30,
    marginTop: 24,
    alignItems: 'center',
  },
  saveText: { color: DRYNKS_WHITE, fontWeight: '700', fontSize: 16 },
});

export default EditProfileScreen;

