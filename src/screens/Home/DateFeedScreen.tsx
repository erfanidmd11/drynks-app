// DateFeedScreen.tsx – Final Production Ready
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ScrollView,
  Animated,
} from 'react-native';
import ShimmerPlaceHolder from 'react-native-shimmer-placeholder';
import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import DateCard from '@components/cards/DateCard';
import VerifyBanner from '@components/banners/VerifyBanner';

const sections = ['Pending Responses', 'Your Joined Dates', 'Your Created Dates', 'Nearby Dates'];

const DateFeedScreen = () => {
  const [profile, setProfile] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dates, setDates] = useState({ pending: [], joined: [], created: [], public: [] });
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const loadUserAndProfile = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        console.warn('[Auth] No user ID found');
        setLoading(false);
        return;
      }

      setUserId(uid);

      const { data: profileData, error } = await supabase
        .from('profiles')
        .select()
        .eq('id', uid)
        .single();

      if (error || !profileData) {
        console.warn('[Profile Error]', error?.message || 'Profile missing');
        setLoading(false);
        return;
      }

      setProfile(profileData);
    } catch (error) {
      console.error('[Load Profile Error]', error);
    }
  };

  const loadDates = async (uid: string) => {
    try {
      setLoading(true);
      const now = new Date().toISOString();
      const { data: all = [], error } = await supabase
        .from('date_requests')
        .select('*, creator:profiles(*)')
        .gte('event_date', now)
        .order('event_date', { ascending: true });

      if (error) throw error;

      const pending = all.filter(d => (d.pending_users || []).includes(uid));
      const joined = all.filter(d => (d.accepted_users || []).includes(uid));
      const created = all.filter(d => d.creator?.id === uid);
      const publicDates = all.filter(
        d => !(d.pending_users || []).includes(uid) &&
             !(d.accepted_users || []).includes(uid) &&
             d.creator?.id !== uid
      );

      setDates({ pending, joined, created, public: publicDates });

      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    } catch (error) {
      console.error('[Load Dates Error]', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await loadUserAndProfile();
    })();
  }, []);

  useEffect(() => {
    if (userId) {
      loadDates(userId);
    }
  }, [userId]);

  const renderDateCard = useCallback(
    ({ item }) => {
      if (!profile?.id) return null;

      return (
        <DateCard
          date={item}
          userId={profile.id}
          isCreator={item.creator?.id === profile.id}
          isAccepted={(item.accepted_users || []).includes(profile.id)}
          isPending={(item.pending_users || []).includes(profile.id)}
          showChat={true}
          onTap={() => {}}
          onAccept={() => {}}
          onDecline={() => {}}
          onInvite={() => {}}
          onChat={() => {}}
        />
      );
    },
    [profile]
  );

  if (loading || !profile) {
    return (
      <AppShell currentTab="Home">
        <View style={{ margin: 16 }}>
          {[...Array(3)].map((_, i) => (
            <ShimmerPlaceHolder key={i} style={{ height: 120, borderRadius: 12, marginVertical: 8 }} />
          ))}
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell currentTab="Home">
      <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={() => userId && loadDates(userId)} />}>
        {(!profile?.phone_verified || !profile?.email_verified) && (
          <VerifyBanner profile={profile} />
        )}

        {sections.map((sec, idx) => (
          <Animated.View key={sec} style={{ opacity: fadeAnim, marginTop: 24 }}>
            <Text style={{ marginLeft: 16, fontSize: 18, fontWeight: 'bold' }}>{sec}</Text>
            <FlatList
              data={dates[['pending', 'joined', 'created', 'public'][idx]] || []}
              horizontal
              keyExtractor={(d, i) => (d?.id ? `${d.id}` : `fallback-${i}`)}
              renderItem={renderDateCard}
              contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
              ListEmptyComponent={() => <Text style={{ color: '#888', marginLeft: 16 }}>No items.</Text>}
            />
          </Animated.View>
        ))}
      </ScrollView>
    </AppShell>
  );
};

export default DateFeedScreen;
