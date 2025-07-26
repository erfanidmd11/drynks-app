// ManageApplicantsScreen.tsx – Animated & Polished
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, Alert
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import ProfileCard from '@components/cards/ProfileCard';
import Animated, { FadeInUp } from 'react-native-reanimated';

const ManageApplicantsScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { dateId } = route.params || {};

  const [applicants, setApplicants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApplicants();
  }, []);

  const fetchApplicants = async () => {
    setLoading(true);
    try {
      const { data: date } = await supabase
        .from('date_requests')
        .select('pending_users')
        .eq('id', dateId)
        .single();

      if (!date?.pending_users?.length) {
        setApplicants([]);
        setLoading(false);
        return;
      }

      const { data: users, error } = await supabase
        .from('profiles')
        .select('*')
        .in('id', date.pending_users);

      if (error) throw error;

      setApplicants(users);
    } catch (err) {
      console.error('[Applicants Load Error]', err);
      Alert.alert('Error', 'Unable to load applicants.');
    } finally {
      setLoading(false);
    }
  };

  const respond = async (userId: string, accept: boolean) => {
    const action = accept ? 'accepted' : 'declined';
    const wittyMsg = accept
      ? 'You just made someone’s day 💌'
      : 'Maybe next time... ❄️';
    try {
      const { error } = await supabase.rpc('respond_to_date', {
        date_id_input: dateId,
        user_id_input: userId,
        accept,
      });

      if (error) throw error;

      Alert.alert('Response Sent', wittyMsg);

      // Handle chat group creation or removal
      if (accept) {
        await supabase.rpc('add_user_to_chat_group', {
          date_id_input: dateId,
          user_id_input: userId,
        });
      } else {
        await supabase.rpc('remove_user_from_chat_group', {
          date_id_input: dateId,
          user_id_input: userId,
        });
      }
      fetchApplicants();
    } catch (err) {
      Alert.alert('Error', 'Could not respond to user.');
    }
  };

  return (
    <AppShell currentTab="My DrYnks">
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#ff5a5f" />
        </View>
      ) : applicants.length === 0 ? (
        <Animated.View entering={FadeInUp} style={styles.center}>
          <Text>No applicants yet... but it’s early! 🌅</Text>
        </Animated.View>
      ) : (
        <FlatList
          data={applicants}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInUp.delay(index * 60)}>
              <ProfileCard
                user={item}
                onInvite={() => respond(item.id, true)}
              />
              <Text style={styles.decline} onPress={() => respond(item.id, false)}>
                ❌ Decline this request
              </Text>
            </Animated.View>
          )}
          ListFooterComponent={<Text style={styles.footer}>Scroll through your admirers and make your move 💌</Text>}
        />
      )}
    </AppShell>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 13,
    color: '#999',
  },
  decline: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
    marginBottom: 20,
  },
});

export default ManageApplicantsScreen;
