// EditProfileScreen – robust uploads, locked identity fields, location autocomplete,
// preferences (multi), orientation (single), profile/gallery (min 3, max 10),
// replace & promote-to-profile actions, origin-aware header

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { decode as atob } from 'base-64';
import { v4 as uuidv4 } from 'uuid';
import { useNavigation, useRoute } from '@react-navigation/native';
import CustomLocationInput from '@components/CustomLocationInput';
import RoundedBackButton from '@components/nav/RoundedBackButton';
import { supabase } from '@config/supabase';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';
const { width } = Dimensions.get('window');

const PROFILE_BUCKET = 'profile-photos'; // create in Supabase storage (public) or make signed if private
const MAX_GALLERY = 10;
const MIN_GALLERY = 3;

type ProfileRow = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  screenname?: string | null;
  profile_photo?: string | null;
  gallery_photos?: string[] | null;
  about?: string | null;
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

async function uploadImageToStorage(localUri: string, userId: string): Promise<string> {
  // Normalize and compress before upload
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
    .upload(filePath, bytes, { contentType: 'image/jpeg', upsert: true });

  if (error || !data) throw error || new Error('Upload failed');

  // Public URL (if bucket is public). If private, switch to createSignedUrl here.
  const pub = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(data.path);
  const url = pub?.data?.publicUrl;
  if (!url) throw new Error('Could not resolve public URL for uploaded image');
  return url;
}

const Chip: React.FC<{ active: boolean; onPress: () => void; children: React.ReactNode }> = ({ active, onPress, children }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}
    activeOpacity={0.8}
  >
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{children}</Text>
  </TouchableOpacity>
);

const EditProfileScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute() as any;
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
  const [location, setLocation] = useState<string>('');
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
  const [orientation, setOrientation] = useState<string>('Straight');
  const [preferences, setPreferences] = useState<string[]>([]);

  // Photos
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [gallery, setGallery] = useState<string[]>([]);

  const age = useMemo(() => ageFromBirthdate(birthdate), [birthdate]);

  useLayoutEffect(() => {
    const goBackSmart = () => {
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('PublicProfile');
    };
    navigation.setOptions({
      headerTitle: 'Edit Profile',
      headerLeft: () => <RoundedBackButton onPress={goBackSmart} />,
      headerRight: () => (
        <TouchableOpacity onPress={handleSave} disabled={saving} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: saving ? '#aaa' : DRYNKS_RED, fontWeight: '700' }}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, saving]); // eslint-disable-line react-hooks/exhaustive-deps

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

        setAbout(p.about || '');
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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.85,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setGallery((prev) => {
        const copy = [...prev];
        copy[index] = uri; // mark as local; will be uploaded on Save
        return copy;
      });
    } catch (err) {
      Alert.alert('Error', 'Could not pick an image.');
    }
  };

  const addGalleryPhoto = async () => {
    if (gallery.length >= MAX_GALLERY) {
      Alert.alert('Limit reached', `You can upload up to ${MAX_GALLERY} gallery photos.`);
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.85,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setGallery((prev) => [...prev, uri]); // local; upload on Save
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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.9,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setAvatarUrl(uri); // local; upload on Save
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

    // Validate
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

      // Keep original location if user cleared it
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

      const updates: Partial<ProfileRow> = {
        profile_photo: finalAvatar,
        gallery_photos: finalGallery,
        about,
        location: safeLocation,
        latitude: finalLat,
        longitude: finalLng,
        orientation,
        preferences,
      };

      const { error } = await supabase.from('profiles').update(updates).eq('id', me);
      if (error) throw error;

      Alert.alert('Saved', 'Profile updated successfully.');
      // Go back to profile; if we came from ProfileDetails, popping reveals it
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('PublicProfile', { userId: me });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={DRYNKS_RED} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
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

      {/* Editable fields */}
      <Text style={styles.section}>Profile details</Text>

      <Text style={styles.label}>Location</Text>
      <View style={{ zIndex: 1000 }}>
        <CustomLocationInput
          value={location}
          onLocationSelect={({ name, latitude, longitude }) => {
            setLocation(name);
            setCoords({ latitude, longitude });
          }}
        />
      </View>

      <Text style={styles.label}>Who are you into?</Text>
      <View style={styles.rowWrap}>
        {GENDER_PREFS.map(g => (
          <Chip key={g} active={preferences.includes(g)} onPress={() => togglePref(g)}>
            {g}
          </Chip>
        ))}
      </View>

      <Text style={styles.label}>Sexual orientation</Text>
      <View style={styles.rowWrap}>
        {ORIENTATIONS.map(o => (
          <Chip key={o} active={orientation === o} onPress={() => setOrientation(o)}>
            {o}
          </Chip>
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

      <Text style={styles.section}>Photos</Text>

      {/* Avatar */}
      <Text style={styles.label}>Profile photo</Text>
      <TouchableOpacity onPress={pickAvatar} activeOpacity={0.85}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
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
            <Image source={{ uri: item }} style={styles.galleryPhoto} />
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

      <TouchableOpacity onPress={handleSave} style={[styles.saveButton, saving && { opacity: 0.7 }]} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>💾 Save Changes</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
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

  chip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: DRYNKS_BLUE, borderColor: DRYNKS_BLUE },
  chipText: { color: '#111827', fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  avatar: {
    width: Math.min(160, width * 0.6),
    height: Math.min(160, width * 0.6),
    borderRadius: 999,
    marginTop: 10,
    alignSelf: 'flex-start',
  },

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
});

export default EditProfileScreen;

