// SignupStepTen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, FlatList, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AnimatedScreenWrapper from '../../components/common/AnimatedScreenWrapper';
import OnboardingNavButtons from '../../components/common/OnboardingNavButtons';

const MAX_PHOTOS = 10;
const MIN_PHOTOS = 3;

const SignupStepTen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { username } = route.params as { username: string };

  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [galleryPhotos, setGalleryPhotos] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      await ImagePicker.requestCameraPermissionsAsync();
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    })();
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled && result.assets[0].uri) {
      const newUri = result.assets[0].uri;
      if (!profilePhoto) {
        setProfilePhoto(newUri);
      } else if (galleryPhotos.length < MAX_PHOTOS) {
        setGalleryPhotos([...galleryPhotos, newUri]);
      }
    }
  };

  const deletePhoto = (uri: string) => {
    if (uri === profilePhoto) {
      setProfilePhoto(null);
    } else {
      setGalleryPhotos(galleryPhotos.filter(p => p !== uri));
    }
  };

  const handleFinish = async () => {
    if (!profilePhoto) {
      Alert.alert('Hold up!', 'You must upload a profile photo.');
      return;
    }
    if (galleryPhotos.length < MIN_PHOTOS) {
      Alert.alert('Almost there!', `Please add at least ${MIN_PHOTOS} photos to your gallery.`);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      await supabase.from('profiles').upsert({
        id: userData.user.id,
        profile_photo: profilePhoto,
        gallery_photos: galleryPhotos,
        current_step: 'ProfileSetupStepTen',
      });
    }

    navigation.navigate('Home');
  };

  return (
    <AnimatedScreenWrapper>
      <View style={styles.container}>
        <Text style={styles.header}>Lookin’ Good, @{username}! 📸</Text>
        <Text style={styles.subtext}>Upload your profile pic and 3–10 gallery shots. Drag to reorder (coming soon!).</Text>

        <Text style={styles.label}>Profile Photo</Text>
        {profilePhoto ? (
          <TouchableOpacity onLongPress={() => deletePhoto(profilePhoto)}>
            <Image source={{ uri: profilePhoto }} style={styles.profileImage} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.uploadBox} onPress={pickImage}>
            <Text>Tap to upload profile photo</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.label}>Gallery Photos ({galleryPhotos.length}/{MAX_PHOTOS})</Text>
        <FlatList
          data={galleryPhotos}
          keyExtractor={(item) => item}
          horizontal
          renderItem={({ item }) => (
            <TouchableOpacity onLongPress={() => deletePhoto(item)}>
              <Image source={{ uri: item }} style={styles.galleryImage} />
            </TouchableOpacity>
          )}
        />

        <TouchableOpacity style={styles.uploadBox} onPress={pickImage}>
          <Text>+ Add Photo</Text>
        </TouchableOpacity>

        <OnboardingNavButtons onNext={handleFinish} />
      </View>
    </AnimatedScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    paddingTop: 40,
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtext: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 10,
  },
  uploadBox: {
    height: 120,
    backgroundColor: '#eee',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
  },
  profileImage: {
    height: 120,
    width: 120,
    borderRadius: 60,
    alignSelf: 'center',
    marginVertical: 10,
  },
  galleryImage: {
    height: 80,
    width: 80,
    marginRight: 10,
    borderRadius: 8,
  },
});

export default SignupStepTen;