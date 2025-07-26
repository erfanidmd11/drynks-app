import React, { useState, useEffect } from 'react';
import {
  View, TouchableOpacity, Text, StyleSheet, Modal, Alert, Image, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#E1EBF2';
const DRYNKS_WHITE = '#FFFFFF';

const ProfileMenu = () => {
  const navigation = useNavigation();
  const [visible, setVisible] = useState(false);
  const [profileUrl, setProfileUrl] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const fadeAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;
      setCurrentUserId(userId);

      const { data: profile } = await supabase
        .from('profiles')
        .select('profile_photo')
        .eq('id', userId)
        .single();

      if (profile?.profile_photo) {
        if (profile.profile_photo.startsWith('http')) {
          setProfileUrl(profile.profile_photo);
        } else {
          const { data: publicUrl } = supabase
            .storage
            .from('profile-photos')
            .getPublicUrl(profile.profile_photo);
          setProfileUrl(publicUrl?.publicUrl || '');
        }
      }
    })();
  }, []);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setVisible(false);
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (err) {
      console.error('[Logout Error]', err);
      Alert.alert('Logout Failed', 'Something went wrong.');
    }
  };

  const showMenu = () => {
    setVisible(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };

  const hideMenu = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  };

  return (
    <View style={{ marginLeft: 12 }}>
      <TouchableOpacity onPress={showMenu} hitSlop={10}>
        <Image
          source={{ uri: profileUrl || 'https://cdn-icons-png.flaticon.com/512/847/847969.png' }}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: DRYNKS_GRAY }}
        />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="none">
        <TouchableOpacity style={styles.overlay} onPress={hideMenu} activeOpacity={1}>
          <Animated.View style={[styles.menu, { opacity: fadeAnim }]}>
            <Text style={styles.title}>Your Profile</Text>
            <TouchableOpacity
              onPress={() => {
                hideMenu();
                navigation.navigate('Profile', { userId: currentUserId });
              }}
            >
              <Text style={styles.item}>My Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {}}>
              <Text style={styles.item}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout}>
              <Text style={styles.item}>Logout</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity onPress={() => {}}>
              <Text style={styles.hidden}>Delete Profile</Text>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: 60,
    paddingLeft: 20,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  menu: {
    width: 200,
    backgroundColor: DRYNKS_WHITE,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
  title: {
    fontWeight: '700',
    fontSize: 16,
    color: DRYNKS_BLUE,
    marginBottom: 10,
  },
  item: {
    paddingVertical: 10,
    fontSize: 15,
    color: DRYNKS_BLUE,
  },
  divider: {
    height: 1,
    backgroundColor: DRYNKS_GRAY,
    marginVertical: 10,
  },
  hidden: {
    color: DRYNKS_RED,
    fontSize: 14,
    opacity: 0.7,
  },
});

export default ProfileMenu;
