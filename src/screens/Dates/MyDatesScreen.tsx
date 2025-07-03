// MyDatesScreen.tsx – Production Ready
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { Ionicons } from '@expo/vector-icons';

const MyDatesScreen = () => {
  const [dateRequests, setDateRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation();

  const fetchDateRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('date_requests')
        .select()
        .or(`creator.eq.${user.id},accepted_users.cs.{${user.id}},declined_users.cs.{${user.id}},pending_users.cs.{${user.id}}`)
        .order('event_date');

      if (error) {
        console.error('[Fetch Date Requests Error]', error);
        Alert.alert('Error', 'Failed to load dates.');
      } else {
        setDateRequests(data);
      }
    } catch (err) {
      console.error('[Fetch Error]', err);
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  const respondToDate = async (dateId: string, accept: boolean) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) return;

      const isEmailProvider = user.identities?.[0]?.provider === 'email';
      const emailVerified = !!user.email_confirmed_at;

      if (isEmailProvider && !emailVerified) {
        Alert.alert('Email Not Verified', 'Please verify your email to respond to applicants.');
        return;
      }

      const { error } = await supabase.rpc('respond_to_date', {
        date_id_input: dateId,
        user_id_input: user.id,
        accept,
      });

      if (error) {
        console.error('[Respond Error]', error);
        Alert.alert('Error', 'Failed to respond to the date.');
      } else {
        fetchDateRequests();
      }
    } catch (err) {
      console.error('[Respond Crash]', err);
      Alert.alert('Unexpected Error', 'Something went wrong while responding.');
    }
  };

  useEffect(() => {
    fetchDateRequests();
  }, [fetchDateRequests]);

  const renderItem = ({ item }: { item: any }) => {
    const userId = supabase.auth.getUser().then((u) => u.data?.user?.id);
    const accepted = item.accepted_users?.includes(userId);
    const declined = item.declined_users?.includes(userId);
    const pending = item.pending_users?.includes(userId);

    const eventDate = item.event_date
      ? new Date(item.event_date).toLocaleDateString()
      : 'No Date';

    return (
      <TouchableOpacity
        style={styles.item}
        onPress={() => navigation.navigate('DateDetails', { dateId: item.id })}
      >
        <View style={styles.info}>
          <Text style={styles.title}>{item.title || 'Untitled'}</Text>
          <Text style={styles.subtitle}>{`${item.location || ''} • ${eventDate}`}</Text>
        </View>
        {accepted ? (
          <Ionicons name="checkmark-circle" size={24} color="green" />
        ) : declined ? (
          <Ionicons name="close-circle" size={24} color="red" />
        ) : pending ? (
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => respondToDate(item.id, false)}>
              <Ionicons name="close" size={24} color="red" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => respondToDate(item.id, true)}>
              <Ionicons name="checkmark" size={24} color="green" />
            </TouchableOpacity>
          </View>
        ) : (
          <Ionicons name="help-circle-outline" size={24} color="gray" />
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ff5a5f" />
      </View>
    );
  }

  if (dateRequests.length === 0) {
    return (
      <View style={styles.center}>
        <Text>No dates found.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={dateRequests}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={fetchDateRequests} />
      }
      keyExtractor={(item) => item.id.toString()}
      renderItem={renderItem}
    />
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  info: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
});

export default MyDatesScreen;
