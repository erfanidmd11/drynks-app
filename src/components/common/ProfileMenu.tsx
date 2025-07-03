import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Modal, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';

const ProfileMenu = () => {
  const navigation = useNavigation();
  const [visible, setVisible] = useState(false);

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

  return (
    <View style={{ marginRight: 16 }}>
      <TouchableOpacity onPress={() => setVisible(true)} hitSlop={10}>
        <Image
          source={{ uri: 'https://via.placeholder.com/40' }}
          style={{ width: 32, height: 32, borderRadius: 16 }}
        />
      </TouchableOpacity>
      <Modal visible={visible} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} onPress={() => setVisible(false)}>
          <View style={styles.menu}>
            <Text style={styles.title}>Your Profile</Text>
            <TouchableOpacity onPress={() => {}}>
              <Text style={styles.item}>My Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {}}>
              <Text style={styles.item}>Edit Profile</Text>
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
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 50,
    paddingRight: 10,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  menu: {
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    elevation: 5,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  item: {
    paddingVertical: 8,
    fontSize: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 8,
  },
  hidden: {
    color: '#f00',
    fontSize: 14,
    opacity: 0.6,
  },
});

export default ProfileMenu;
