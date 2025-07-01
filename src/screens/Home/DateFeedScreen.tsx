// src/screens/Home/DateFeedScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, RefreshControl, ScrollView, Animated } from 'react-native';
import ShimmerPlaceHolder from 'react-native-shimmer-placeholder';
import { supabase } from '../../config/supabase';
import AppShell from '../../components/AppShell';
import DateCard from '../../components/cards/DateCard';
import VerifyBanner from '../../components/banners/VerifyBanner';


const sections = ['Pending Responses', 'Your Joined Dates', 'Your Created Dates', 'Nearby Dates'];

const DateFeedScreen = () => {
  const [profile, setProfile] = useState<any>();
  const [dates, setDates] = useState({ pending: [], joined: [], created: [], public: [] });
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const loadProfile = async () => {
    const uid = await supabase.auth.getUser().then(r => r.data.user?.id);
    const { data } = await supabase.from('profiles').select().eq('id', uid).single();
    setProfile(data);
  };

  const loadDates = async () => {
    setLoading(true);
    const now = new Date().toISOString();
    const { data: all = [] } = await supabase
      .from('date_requests')
      .select('*, creator:profiles(*)')
      .gte('event_date', now)
      .order('event_date', { ascending: true });

    const uid = await supabase.auth.getUser().then(r => r.data.user?.id);
    const pending = all.filter(d => (d.pending_users || []).includes(uid));
    const joined = all.filter(d => (d.accepted_users || []).includes(uid));
    const created = all.filter(d => d.creator === uid);
    const publicDates = all.filter(d => !d.pending_users?.includes(uid) && !d.accepted_users?.includes(uid) && d.creator !== uid);

    setDates({ pending, joined, created, public: publicDates });
    setLoading(false);
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  };

  useEffect(() => {
    loadProfile();
    loadDates();
  }, []);

  const renderDateCard = ({ item }) => (
    <DateCard
      date={item}
      userId={profile?.id}
      isCreator={item.creator === profile?.id}
      isAccepted={item.accepted_users?.includes(profile?.id)}
      isPending={item.pending_users?.includes(profile?.id)}
      showChat={true}
      onTap={() => {}}
      onAccept={() => {}}
      onDecline={() => {}}
      onInvite={() => {}}
      onChat={() => {}}
    />
  );

  if (loading) {
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
      <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={loadDates} />}>
        {(!profile?.phone_verified || !profile?.email_verified) && (
          <VerifyBanner profile={profile} />
        )}
        {sections.map((sec, idx) => (
          <Animated.View key={sec} style={{ opacity: fadeAnim, marginTop: 24 }}>
            <Text style={{ marginLeft: 16, fontSize: 18, fontWeight: 'bold' }}>{sec}</Text>
            <FlatList
              data={dates[['pending','joined','created','public'][idx]]}
              horizontal
              keyExtractor={d => d.id.toString()}
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
