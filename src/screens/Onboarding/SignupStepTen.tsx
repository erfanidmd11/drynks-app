// src/screens/Onboarding/SignupStepTen.tsx
// SignupStepTen.tsx – Final Fix: Upload using FormData (no Blob, Buffer, or atob)
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator,
  Platform, FlatList, Dimensions, Animated, KeyboardAvoidingView
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import { supabase } from '@config/supabase';
import { useNavigation, useRoute } from '@react-navigation/native';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_WHITE = '#FFFFFF';

const MAX = 10;
const MIN = 3;
const screenWidth = Dimensions.get('window').width;
const numColumns = 3;
const itemSize = (screenWidth - 40 - (numColumns - 1) * 10) / numColumns;

const SignupStepTen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { screenname, first_name, phone } = route.params ?? {};

  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [galleryPhotos, setGalleryPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fadeAnim = new Animated.Value(0);

  useEffect(() => {
    (async () => {
      await ImagePicker.requestCameraPermissionsAsync();
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    })();

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  const enhanceImage = async (uri: string): Promise<string> => {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1080 } }, { rotate: 0 }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      return result.uri;
    } catch (err) {
      console.error('[Enhance Error]', err);
      return uri;
    }
  };

  const uploadToSupabase = async (uri: string, userId: string, isProfile = false): Promise<string | null> => {
    const bucket = isProfile ? 'profile-photos' : 'user-photos';
    try {
      const filename = `${userId}/${Date.now()}-${(uri.split('/').pop() ?? 'image.jpg')}`;
      const fileType = 'image/jpeg';

      const formData = new FormData();
      formData.append('file' as any, {
        uri,
        name: filename,
        type: fileType,
      } as any);

      const { data, error } = await supabase.storage.from(bucket).upload(filename, formData as any, {
        contentType: fileType,
        upsert: true,
      });

      if (error || !data) {
        console.error('[Upload Error]', error);
        return null;
      }

      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
      if (!urlData?.publicUrl) {
        console.error('[Public URL Error]');
        return null;
      }

      return urlData.publicUrl;
    } catch (err) {
      console.error('[Upload Failed]', { uri, error: err });
      return null;
    }
  };

  const pickImage = async (fromCamera = false) => {
    try {
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 1 });

      if (!result.canceled && result.assets?.length > 0) {
        const enhancedUri = await enhanceImage(result.assets[0].uri);
        if (!profilePhoto) {
          setProfilePhoto(enhancedUri);
        } else if (galleryPhotos.length < MAX) {
          setGalleryPhotos((prev) => [enhancedUri, ...prev]);
        } else {
          Alert.alert('Limit Reached', `You can only upload ${MAX} photos.`);
        }
      }
    } catch (err) {
      console.error('[Picker Error]', err);
      Alert.alert('Error', 'Could not pick image.');
    }
  };

  const deletePhoto = (uri: string) => {
    if (uri === profilePhoto) setProfilePhoto(null);
    else setGalleryPhotos((prev) => prev.filter((p) => p !== uri));
  };

  const handleFinish = async () => {
    if (!profilePhoto) {
      Alert.alert('Missing Profile Photo', 'Upload a profile photo to continue.');
      return;
    }
    if (galleryPhotos.length < MIN) {
      Alert.alert('Not Enough Photos', `Please upload at least ${MIN} gallery photos.`);
      return;
    }

    setUploading(true);
    const { data: userData, error } = await supabase.auth.getUser();
    if (error || !userData?.user?.id || !userData.user.email) {
      Alert.alert('Session Error', 'Please log in again.');
      navigation.navigate('Login' as never);
      return;
    }

    try {
      const profileUrl = await uploadToSupabase(profilePhoto, userData.user.id, true);
      const galleryUrls = await Promise.all(
        galleryPhotos.map((uri) => uploadToSupabase(uri, userData.user.id))
      );

      const successful = !!profileUrl && galleryUrls.every((url) => !!url);
      if (!successful) {
        Alert.alert('Upload Failed', 'Some images failed to upload. Please try again.');
        return;
      }

      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: userData.user.id,
        email: userData.user.email,
        screenname,
        first_name,
        phone,
        profile_photo: profileUrl!,
        gallery_photos: galleryUrls as string[],
        current_step: 'ProfileSetupStepTen',
        has_completed_profile: true,
      });

      if (upsertError) {
        Alert.alert('Database Error', 'Could not save profile data.');
        return;
      }

      navigation.navigate('ProfileSetupStepEleven' as never, {
        userId: userData.user.id,
        screenname,
        first_name,
        phone,
      } as never);
    } catch (err) {
      Alert.alert('Unexpected Error', 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const renderPhotoItem = ({ item }: { item: string }) => (
    <View style={styles.gridItem}>
      <Image source={{ uri: item }} style={styles.gridImage} />
      <TouchableOpacity style={styles.deleteOverlay} onPress={() => deletePhoto(item)}>
        <Ionicons name="close-circle" size={22} color={DRYNKS_WHITE} />
      </TouchableOpacity>
    </View>
  );

  return (
    <AnimatedScreenWrapper>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
          <Text style={styles.header}>Lookin’ Good! 📸</Text>
          <Text style={styles.subtext}>Upload a profile pic and 3–10 gallery shots.</Text>

          <Text style={styles.label}>Profile Photo</Text>
          {profilePhoto ? (
            <TouchableOpacity onPress={() => pickImage(false)}>
              <Image source={{ uri: profilePhoto }} style={styles.profileImage} />
              <Ionicons
                style={styles.profileDelete}
                name="close-circle"
                size={26}
                color={DRYNKS_RED}
                onPress={() => deletePhoto(profilePhoto)}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.uploadBox} onPress={() => pickImage(false)}>
              <Text>Tap to select profile photo</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.label}>Gallery ({galleryPhotos.length}/{MAX})</Text>
          <FlatList
            data={galleryPhotos}
            keyExtractor={(item) => item}
            renderItem={renderPhotoItem}
            numColumns={numColumns}
            contentContainerStyle={styles.grid}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: DRYNKS_BLUE }]} onPress={() => pickImage(false)}>
              <Text style={{ color: DRYNKS_WHITE }}>+ Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: DRYNKS_RED }]} onPress={() => pickImage(true)}>
              <Text style={{ color: DRYNKS_WHITE }}>📷 Camera</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <View style={styles.footerWrap}>
          {uploading ? (
            <ActivityIndicator size="large" color={DRYNKS_RED} />
          ) : (
            <TouchableOpacity style={[styles.submitButton, { backgroundColor: DRYNKS_RED }]} onPress={handleFinish}>
              <Text style={styles.submitText}>Finish & Continue</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, paddingBottom: 90, backgroundColor: DRYNKS_WHITE },
  header: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 8, color: DRYNKS_BLUE },
  subtext: { fontSize: 14, color: DRYNKS_BLUE, textAlign: 'center', marginBottom: 16 },
  label: { fontWeight: '600', marginVertical: 10, color: '#23303A' },
  profileImage: { width: 120, height: 120, borderRadius: 60, alignSelf: 'center', marginBottom: 10 },
  profileDelete: { position: 'absolute', top: -5, right: '35%' },
  uploadBox: {
    height: 120, justifyContent: 'center', alignItems: 'center', borderRadius: 8,
    backgroundColor: '#eee', marginBottom: 10
  },
  grid: { gap: 10, marginBottom: 10 },
  gridItem: {
    width: itemSize, height: itemSize, marginBottom: 10,
    borderRadius: 8, overflow: 'hidden', position: 'relative',
  },
  gridImage: { width: '100%', height: '100%' },
  deleteOverlay: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 11, padding: 2,
  },
  buttonRow: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 10
  },
  actionButton: {
    flex: 1, height: 48, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', marginHorizontal: 5
  },
  footerWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 20, backgroundColor: DRYNKS_WHITE, borderTopColor: DRYNKS_BLUE, borderTopWidth: 1
  },
  submitButton: {
    height: 48, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center'
  },
  submitText: { color: DRYNKS_WHITE, fontWeight: '600', fontSize: 16 },
});

export default SignupStepTen;
