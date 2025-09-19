// src/screens/Dates/SentInvitesScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@config/supabase';
import { notifyInviteRevoked } from '@services/NotificationService';

type InviteRow = {
  id: string;
  date_id: string;
  inviter_id: string;
  invitee_id: string;
  status: 'pending' | 'accepted' | 'revoked' | 'dismissed';
  created_at: string;
};

type DateRow = {
  id: string;
  inviter_id: string;
  title: string;
  event_date?: string | null;
  location?: string | null;
};

type ProfileRow = {
  id: string;
  screenname?: string | null;
  first_name?: string | null;
  profile_photo?: string | null;
};

type InviteItem = {
  invite: InviteRow;
  date: DateRow | undefined;
  invitee: ProfileRow | undefined;
};

const SectionHeader = ({ title }: { title: string }) => (
  <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#0a0a0a' }}>
    <Text style={{ color: '#bbb', fontWeight: '600', fontSize: 12 }}>{title}</Text>
  </View>
);

const RightAction = ({ label, color }: { label: string; color: string }) => (
  <View
    style={{
      backgroundColor: color,
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingHorizontal: 16,
      width: 120,
      height: '100%',
    }}
  >
    <Text style={{ color: '#fff', fontWeight: '700' }}>{label}</Text>
  </View>
);

export default function SentInvitesScreen() {
  const nav = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<InviteItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        setItems([]);
        return;
      }

      // 1) Fetch my pending invites (I am the inviter)
      const { data: invites, error: invErr } = await supabase
        .from('invites')
        .select('id,date_id,inviter_id,invitee_id,status,created_at')
        .eq('inviter_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (invErr) throw invErr;

      const dateIds = Array.from(new Set((invites ?? []).map((i) => i.date_id)));
      const inviteeIds = Array.from(new Set((invites ?? []).map((i) => i.invitee_id)));

      // 2) Batch fetch dates
      let datesById = new Map<string, DateRow>();
      if (dateIds.length) {
        const { data: dates, error: dErr } = await supabase
          .from('dates')
          .select('id,inviter_id,title,event_date,location')
          .in('id', dateIds);
        if (dErr) throw dErr;
        datesById = new Map((dates ?? []).map((d) => [d.id, d]));
      }

      // 3) Batch fetch invitee profiles
      let profilesById = new Map<string, ProfileRow>();
      if (inviteeIds.length) {
        const { data: profs, error: pErr } = await supabase
          .from('profiles')
          .select('id,screenname,first_name,profile_photo')
          .in('id', inviteeIds);
        if (pErr) throw pErr;
        profilesById = new Map((profs ?? []).map((p) => [p.id, p]));
      }

      const merged: InviteItem[] = (invites ?? []).map((invite) => ({
        invite,
        date: datesById.get(invite.date_id),
        invitee: profilesById.get(invite.invitee_id),
      }));

      setItems(merged);
    } catch (e: any) {
      console.error('[SentInvites] load error', e?.message || e);
      Alert.alert('Error', 'Failed to load your sent invites.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // One-time tip for swipe action
  const showSwipeHint = useCallback(async () => {
    try {
      const seen = await AsyncStorage.getItem('hint_sent_invites');
      if (!seen) {
        Alert.alert('Tip', 'Swipe left on an invite to revoke it.', [
          { text: 'Got it', onPress: () => AsyncStorage.setItem('hint_sent_invites', 'true') },
        ]);
      }
    } catch {}
  }, []);

  useEffect(() => {
    load();
    showSwipeHint();
  }, [load, showSwipeHint]);

  useFocusEffect(
    useCallback(() => {
      // Refetch when screen gains focus
      load();
    }, [load])
  );

  const grouped = useMemo(() => {
    const byDate = new Map<string, InviteItem[]>();
    for (const it of items) {
      const key = it.date?.id ?? 'unknown';
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(it);
    }
    // sort dates by newest invite time
    return Array.from(byDate.entries()).sort((a, b) => {
      const aTime = new Date(a[1][0]?.invite.created_at).getTime();
      const bTime = new Date(b[1][0]?.invite.created_at).getTime();
      return bTime - aTime;
    });
  }, [items]);

  const revokeInvite = useCallback(
    async (invite: InviteRow, date: DateRow | undefined, invitee: ProfileRow | undefined) => {
      if (!userId) return;
      try {
        // Optimistic UI
        setItems((prev) => prev.filter((x) => x.invite.id !== invite.id));

        // Persist
        const { error } = await supabase
          .from('invites')
          .update({ status: 'revoked' })
          .eq('id', invite.id)
          .eq('inviter_id', userId)
          .eq('status', 'pending');

        if (error) throw error;

        // Push + bell to invitee (optional on revocation; you asked for it)
        if (invitee?.id && date?.title) {
          await notifyInviteRevoked({
            recipientId: invitee.id,
            dateId: invite.date_id,
            eventTitle: date.title,
          });
        }
      } catch (e: any) {
        console.error('[SentInvites] revoke error', e?.message || e);
        Alert.alert('Error', 'Could not revoke invite.');
        // rollback reload
        load();
      }
    },
    [userId, load]
  );

  const renderRow = ({ item }: { item: InviteItem }) => {
    const { invite, date, invitee } = item;

    const rightActions = () => <RightAction label="Revoke" color="#e11d48" />;

    const onPress = () => {
      // Open DateDetails if present; otherwise navigate to feed with scroll
      if (date?.id) {
        nav.navigate('DateFeed', { scrollToDateId: date.id, origin: 'SentInvites' });
      }
    };

    const onRevoke = () => {
      Alert.alert(
        'Revoke invite?',
        `This will remove the invite for ${invitee?.screenname || invitee?.first_name || 'this user'}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Revoke', style: 'destructive', onPress: () => revokeInvite(invite, date, invitee) },
        ]
      );
    };

    return (
      <Swipeable renderRightActions={rightActions} onSwipeableOpen={onRevoke}>
        <TouchableOpacity
          onPress={onPress}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderBottomColor: '#222',
            borderBottomWidth: 1,
            backgroundColor: '#0d0d0d',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
            {date?.title || 'Untitled date'}
          </Text>
          <Text style={{ color: '#aaa', marginTop: 4 }}>
            Invited: {invitee?.screenname || invitee?.first_name || invite.invitee_id}
          </Text>
          {!!date?.location && <Text style={{ color: '#777', marginTop: 2 }}>{date.location}</Text>}
        </TouchableOpacity>
      </Swipeable>
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#ff5a5f" />
      </View>
    );
  }

  if (!items.length) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ color: '#aaa', textAlign: 'center' }}>
          You haven’t sent any pending invites. Create a date and invite people from Invite Nearby.
        </Text>
      </View>
    );
  }

  return (
    <>
      {/* Inline hint banner */}
      <View style={{ padding: 10, backgroundColor: '#111' }}>
        <Text style={{ color: '#888', fontSize: 13, textAlign: 'center' }}>
          Swipe left on an invite to revoke it.
        </Text>
      </View>

      <FlatList
        style={{ flex: 1, backgroundColor: '#000' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#ff5a5f" />}
        data={grouped}
        keyExtractor={([dateId]) => dateId}
        renderItem={({ item: [dateId, rows] }) => (
          <View>
            <SectionHeader title={rows[0]?.date?.title || 'Untitled date'} />
            {rows.map((it) => (
              <View key={it.invite.id}>{renderRow({ item: it })}</View>
            ))}
          </View>
        )}
      />
    </>
  );
}
