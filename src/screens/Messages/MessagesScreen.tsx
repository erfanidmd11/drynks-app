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
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { SwipeListView } from 'react-native-swipe-list-view';
import AppShell from '@components/AppShell';

const MessagesScreen = () => {
  const [search, setSearch] = useState('');
  const [dateThreads, setDateThreads] = useState<any[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<{ [key: string]: number }>({});
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<any>(); // ✅ typed to avoid “never” errors

  const fetchUserDates = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('date_requests')
        .select('*, chat_messages!date_id(id, created_at, content)')
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

      // ✅ Cast to satisfy TS without changing your route name/params
      navigation.navigate('ChatScreen' as never, { dateId } as never);
    } catch (err) {
      console.error('[Chat Open Error]', err);
      Alert.alert('Error', 'Failed to open chat.');
    }
  };

  const deleteDateThread = async (dateId: string) => {
    try {
      const { error } = await supabase.from('date_requests').delete().eq('id', dateId);
      if (error) throw error;
      setDateThreads(prev => prev.filter(d => d.id !== dateId));
    } catch (err) {
      console.error('[Delete Thread Error]', err);
      Alert.alert('Error', 'Could not delete conversation.');
    }
  };

  useEffect(() => {
    fetchUserDates();
  }, [fetchUserDates]);

  const filteredThreads = dateThreads.filter(d =>
    d.title?.toLowerCase().includes(search.toLowerCase()) ||
    d.location?.toLowerCase().includes(search.toLowerCase()) ||
    d.chat_messages?.at(-1)?.content?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell currentTab="Vibe">
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#ff5a5f" />
        </View>
      ) : dateThreads.length === 0 ? (
        <View style={styles.center}>
          <Text>You have no date messages yet.</Text>
        </View>
      ) : (
        <>
          <TextInput
            style={{ backgroundColor: '#f0f0f0', padding: 10, margin: 12, borderRadius: 8 }}
            placeholder="Search your conversations..."
            value={search}
            onChangeText={setSearch}
          />
          <SwipeListView
            data={filteredThreads}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchUserDates} />}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item, index }) => {
              const unread = unreadCounts[item.id] || 0;
              const preview = item.chat_messages?.at(-1)?.content || '';

              return (
                <Animated.View entering={FadeInUp.delay(index * 50)}>
                  <TouchableOpacity style={styles.item} onPress={() => openChatIfVerified(item.id)}>
                    <Ionicons name="wine" size={24} color="#333" style={styles.icon} />
                    <View style={styles.info}>
                      <Text style={styles.title}>{item.title || 'Untitled Date'}</Text>
                      <Text style={styles.subtitle} numberOfLines={1}>{preview || item.location || ''}</Text>
                    </View>
                    {unread > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{unread}</Text>
                      </View>
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color="#999" />
                    )}
                  </TouchableOpacity>
                </Animated.View>
              );
            }}
            renderHiddenItem={({ item }) => (
              <View style={styles.rowBack}>
                <TouchableOpacity style={styles.deleteButton} onPress={() => deleteDateThread(item.id)}>
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
            rightOpenValue={-75}
          />
        </>
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
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
    marginHorizontal: 10,
    marginVertical: 6,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  rowBack: {
    alignItems: 'center',
    backgroundColor: '#f00',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingRight: 20,
    borderRadius: 12,
    marginHorizontal: 10,
    marginVertical: 6,
  },
  deleteButton: {
    padding: 10,
  },
  deleteText: {
    color: 'white',
    fontWeight: 'bold',
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
    color: '#333',
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
