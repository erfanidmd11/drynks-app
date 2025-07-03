// MessagesScreen.tsx – Production Ready
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { Ionicons } from '@expo/vector-icons';

const MessagesScreen = () => {
  const [dateThreads, setDateThreads] = useState<any[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<{ [key: string]: number }>({});
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation();

  const fetchUserDates = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('date_requests')
        .select('*, chat_messages!date_id(id, created_at)')
        .or(`creator.eq.${user.id},accepted_users.cs.{${user.id}}`);

      if (error || !data) throw error;

      const sorted = [...data].sort((a, b) => {
        const aTime = new Date(a.chat_messages?.at(-1)?.created_at ?? '1970').getTime();
        const bTime = new Date(b.chat_messages?.at(-1)?.created_at ?? '1970').getTime();
        return bTime - aTime;
      });

      const unreadMap: { [key: string]: number } = {};
      await Promise.all(
        sorted.map(async (date) => {
          const dateId = date.id;

          const { data: seenRow } = await supabase
            .from('chat_seen')
            .select('last_seen')
            .eq('date_id', dateId)
            .eq('user_id', user.id)
            .maybeSingle();

          const lastSeen = seenRow?.last_seen ?? '1970-01-01T00:00:00Z';

          const { data: unread } = await supabase
            .from('chat_messages')
            .select('id')
            .eq('date_id', dateId)
            .gt('created_at', lastSeen);

          unreadMap[dateId] = unread?.length || 0;
        })
      );

      setDateThreads(sorted);
      setUnreadCounts(unreadMap);
    } catch (err: any) {
      console.error('[Messages Load Error]', err);
      Alert.alert('Error', err.message || 'Unable to load messages.');
    } finally {
      setLoading(false);
    }
  }, []);

  const openChatIfVerified = async (dateId: string) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;

      const isEmail = user?.identities?.[0]?.provider === 'email';
      const emailVerified = !!user?.email_confirmed_at;

      if (isEmail && !emailVerified) {
        Alert.alert('Email Not Verified', 'Please verify your email to access messages.');
        return;
      }

      navigation.navigate('ChatScreen', { dateId });
    } catch (err) {
      console.error('[Chat Open Error]', err);
      Alert.alert('Error', 'Failed to open chat.');
    }
  };

  useEffect(() => {
    fetchUserDates();
  }, [fetchUserDates]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ff5a5f" />
      </View>
    );
  }

  if (dateThreads.length === 0) {
    return (
      <View style={styles.center}>
        <Text>You have no date messages yet.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={dateThreads}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchUserDates} />}
      keyExtractor={(item) => item.id.toString()}
      renderItem={({ item }) => {
        const unread = unreadCounts[item.id] || 0;

        return (
          <TouchableOpacity style={styles.item} onPress={() => openChatIfVerified(item.id)}>
            <Ionicons name="wine" size={24} color="#333" style={styles.icon} />
            <View style={styles.info}>
              <Text style={styles.title}>{item.title || 'Untitled Date'}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{item.location || ''}</Text>
            </View>
            {unread > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread}</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#999" />
            )}
          </TouchableOpacity>
        );
      }}
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
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  icon: {
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  badge: {
    backgroundColor: 'red',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default MessagesScreen;
