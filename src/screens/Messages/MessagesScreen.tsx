// src/screens/Messages/MessagesScreen.tsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { SwipeListView } from 'react-native-swipe-list-view';

import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';

/* -------------------- route names (change if needed) -------------------- */
const GROUP_CHAT_ROUTE = 'GroupChat' as const;
const PRIVATE_CHAT_ROUTE = 'PrivateChat' as const;

/* ------------------------------ local types ------------------------------ */
type ChatMessageRow = { id: string; created_at: string; content: string | null; date_id?: string | null };
type DateThreadRow = {
  id: string;
  title?: string | null;
  location?: string | null;
  creator?: string | null;
  accepted_users?: string[] | null;
  chat_messages?: ChatMessageRow[] | null;
};

type ProfileLite = { id: string; screenname?: string | null; profile_photo?: string | null };

type ThreadItem =
  | {
      kind: 'group';
      id: string;                // date_id
      title: string;
      subtitle: string;
      updatedAt: number;
      unread: number;
      participantsNames: string[];
      lastMessage?: string | null;
    }
  | {
      kind: 'dm';
      id: string;                // peer_id (the other user)
      title: string;             // peer screenname
      subtitle: string;          // last message preview
      updatedAt: number;
      unread: number;            // (best-effort: 0 if not tracked)
      participantsNames: string[]; // [peer name]
      lastMessage?: string | null;
    };

/* ------------------------------ helpers ------------------------------ */

const looksLikeMissing = (e: any) => {
  const code = e?.code || '';
  const msg = (e?.message || '').toLowerCase();
  return code === '42P01' || code === '42703' || msg.includes('does not exist');
};

const toMillis = (iso?: string | null) =>
  iso ? new Date(iso).getTime() || 0 : 0;

/* ------------------------------- screen ------------------------------- */

const MessagesScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [search, setSearch] = useState('');
  const [groupThreads, setGroupThreads] = useState<ThreadItem[]>([]);
  const [dmThreads, setDmThreads] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(true);

  /* ----------------------------- data loading ---------------------------- */

  const fetchGroupThreads = useCallback(async (uid: string) => {
    // Base group threads (dates I host or I’m accepted on) + last messages
    const { data, error } = await supabase
      .from('date_requests')
      .select(
        'id, title, location, creator, accepted_users, chat_messages!date_id(id, created_at, content)'
      )
      .or(`creator.eq.${uid},accepted_users.cs.{${uid}}`);

    if (error) throw error;

    const rows = (data ?? []) as DateThreadRow[];

    // Collect participant ids → map to screennames for search
    const participantIds = new Set<string>();
    rows.forEach((r) => {
      if (r.creator) participantIds.add(r.creator);
      (r.accepted_users || []).forEach((id) => participantIds.add(id));
    });

    let namesById = new Map<string, string>();
    if (participantIds.size) {
      const { data: ppl } = await supabase
        .from('profiles')
        .select('id, screenname')
        .in('id', Array.from(participantIds));
      namesById = new Map((ppl || []).map((p: any) => [p.id, p.screenname || '']));
    }

    // Unread per date (best‑effort using chat_seen)
    const unreadByDate = new Map<string, number>();
    await Promise.all(
      rows.map(async (r) => {
        const { data: seenRow } = await supabase
          .from('chat_seen')
          .select('last_seen')
          .eq('date_id', r.id)
          .eq('user_id', uid)
          .maybeSingle();

        const lastSeen = seenRow?.last_seen ?? '1970-01-01T00:00:00Z';
        const { data: unread } = await supabase
          .from('chat_messages')
          .select('id')
          .eq('date_id', r.id)
          .gt('created_at', lastSeen);
        unreadByDate.set(r.id, unread?.length ?? 0);
      })
    );

    const items: ThreadItem[] = rows.map((r) => {
      const last = r.chat_messages?.at(-1);
      const participants: string[] = [
        ...(r.creator ? [namesById.get(r.creator) || ''] : []),
        ...(Array.isArray(r.accepted_users)
          ? r.accepted_users.map((id) => namesById.get(id) || '')
          : []),
      ].filter(Boolean);

      return {
        kind: 'group',
        id: r.id,
        title: r.title || 'Untitled Date',
        subtitle: r.location || (last?.content || ''),
        updatedAt: toMillis(last?.created_at),
        unread: unreadByDate.get(r.id) ?? 0,
        lastMessage: last?.content ?? null,
        participantsNames: participants,
      };
    });

    // Most recent first
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    setGroupThreads(items);
  }, []);

  const fetchDmThreads = useCallback(async (uid: string) => {
    // Try to build DM threads from private_messages
    try {
      const { data, error } = await supabase
        .from('private_messages')
        .select('id, sender_id, recipient_id, content, created_at')
        .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const msgs = (data || []) as any[];
      if (!msgs.length) {
        setDmThreads([]);
        return;
      }

      // Group by peer id (the other participant)
      const byPeer = new Map<
        string,
        { last: any; messages: any[] }
      >();

      msgs.forEach((m) => {
        const peer = m.sender_id === uid ? m.recipient_id : m.sender_id;
        const prev = byPeer.get(peer);
        if (!prev) byPeer.set(peer, { last: m, messages: [m] });
        else {
          prev.messages.push(m);
          if (toMillis(m.created_at) > toMillis(prev.last?.created_at)) prev.last = m;
        }
      });

      const peerIds = Array.from(byPeer.keys());
      let namesById = new Map<string, ProfileLite>();
      if (peerIds.length) {
        const { data: ppl } = await supabase
          .from('profiles')
          .select('id, screenname, profile_photo')
          .in('id', peerIds);
        namesById = new Map((ppl || []).map((p: any) => [p.id, p]));
      }

      const items: ThreadItem[] = peerIds.map((peerId) => {
        const bundle = byPeer.get(peerId)!;
        const last = bundle.last;
        const prof = namesById.get(peerId);
        const name = prof?.screenname || 'User';

        return {
          kind: 'dm',
          id: peerId,
          title: name,
          subtitle: last?.content || '',
          updatedAt: toMillis(last?.created_at),
          unread: 0, // if you track DM seen, wire it here
          lastMessage: last?.content ?? null,
          participantsNames: [name],
        };
      });

      // Most recent first
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      setDmThreads(items);
    } catch (e: any) {
      if (looksLikeMissing(e)) {
        // No private_messages table in this environment — just omit DMs
        setDmThreads([]);
        return;
      }
      console.error('[DM load error]', e);
      setDmThreads([]);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const uid = session?.session?.user?.id;
      if (!uid) throw new Error('User not authenticated');

      await Promise.all([fetchGroupThreads(uid), fetchDmThreads(uid)]);
    } catch (err: any) {
      console.error('[Messages Load Error]', err);
      Alert.alert('Error', err?.message || 'Unable to load messages.');
    } finally {
      setLoading(false);
    }
  }, [fetchGroupThreads, fetchDmThreads]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  /* ----------------------------- search logic ---------------------------- */

  const filtered = useMemo(() => {
    const all: ThreadItem[] = [...groupThreads, ...dmThreads];

    const q = search.trim().toLowerCase();
    if (!q) {
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // 1) Quick in-memory match against titles, locations/subtitles, participants, last messages
    const quick = new Set(
      all
        .filter((t) => {
          const hay =
            `${t.title} ${t.subtitle} ${t.lastMessage || ''} ${t.participantsNames.join(' ')}`
              .toLowerCase();
          return hay.includes(q);
        })
        .map((t) => `${t.kind}:${t.id}`)
    );

    // 2) Deep content search (messages table) — best effort
    //    Group: chat_messages (by date_id)
    //    DMs:   private_messages (by sender/recipient + content)
    const enhance = async () => {
      try {
        // GROUP messages containing q → add those dates
        if (groupThreads.length) {
          const dateIds = groupThreads.map((t) => t.id);
          const { data } = await supabase
            .from('chat_messages')
            .select('date_id')
            .in('date_id', dateIds)
            .ilike('content', `%${q}%`);
          (data || []).forEach((r: any) => quick.add(`group:${r.date_id}`));
        }
      } catch {
        // ignore
      }
      try {
        // DM messages containing q → add those peers
        if (dmThreads.length) {
          const { data, error } = await supabase
            .from('private_messages')
            .select('sender_id, recipient_id, created_at')
            .ilike('content', `%${q}%`);
          if (!error) {
            const { data: session } = await supabase.auth.getSession();
            const uid = session?.session?.user?.id;
            (data || []).forEach((m: any) => {
              if (!uid) return;
              const peer = m.sender_id === uid ? m.recipient_id : m.sender_id;
              if (peer) quick.add(`dm:${peer}`);
            });
          }
        }
      } catch {
        // ignore if private_messages absent
      }
    };

    // Because we can’t block rendering to await deep search, we return quick first,
    // then schedule a refresh (small UX compromise).
    enhance().then(() => {
      // Trigger a re-render only if deep search discovered new matches
      const discovered = all.filter((t) => quick.has(`${t.kind}:${t.id}`));
      if (discovered.length !== out.length) setTick((x) => x + 1);
    });

    const out = all.filter((t) => quick.has(`${t.kind}:${t.id}`));
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, groupThreads, dmThreads]);

  // tiny state to trigger re-render after async deep search enhancement
  const [, setTick] = useState(0);

  /* ------------------------------ navigation ----------------------------- */

  const openThread = useCallback(
    async (t: ThreadItem) => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user;

        // Email-only accounts must confirm before chatting
        const isEmail = user?.identities?.[0]?.provider === 'email';
        const emailVerified = !!user?.email_confirmed_at;
        if (isEmail && !emailVerified) {
          Alert.alert('Email Not Verified', 'Please verify your email to access messages.');
          return;
        }

        if (t.kind === 'group') {
          navigation.navigate(GROUP_CHAT_ROUTE as never, { dateId: t.id, origin: 'Vibe' } as never);
        } else {
          // ✅ param must be `otherUserId` to match RootStackParamList
          navigation.navigate(PRIVATE_CHAT_ROUTE as never, { otherUserId: t.id, origin: 'Vibe' } as never);
        }
      } catch (err) {
        console.error('[Chat Open Error]', err);
        Alert.alert('Error', 'Failed to open chat.');
      }
    },
    [navigation]
  );

  const deleteDateThread = useCallback(async (dateId: string) => {
    Alert.alert(
      'Delete Date?',
      'This removes the event and its messages for everyone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('date_requests').delete().eq('id', dateId);
              if (error) throw error;
              setGroupThreads((prev) => prev.filter((d) => d.id !== dateId));
            } catch (err) {
              console.error('[Delete Thread Error]', err);
              Alert.alert('Error', 'Could not delete conversation.');
            }
          },
        },
      ]
    );
  }, []);

  /* -------------------------------- render -------------------------------- */

  return (
    // No headerTitle — that removes the page name and pushes content up.
    <AppShell currentTab="Vibe" showBack={false}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#ff5a5f" />
        </View>
      ) : groupThreads.length + dmThreads.length === 0 ? (
        <View style={styles.center}>
          <Text>You have no conversations yet.</Text>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.search}
            placeholder="Search your conversations…"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />

          <SwipeListView
            data={filtered}
            keyExtractor={(item) => `${item.kind}:${item.id}`}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={loadThreads} />}
            // Keep swipe-to-delete active only for group items (dates).
            rightOpenValue={-75}
            renderItem={({ item, index }) => {
              const iconName = item.kind === 'group' ? 'wine' : 'person-circle-outline';
              const unread = item.unread || 0;

              return (
                <Animated.View entering={FadeInUp.delay(index * 40)}>
                  <TouchableOpacity
                    style={styles.item}
                    onPress={() => openThread(item)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={iconName as any} size={24} color="#333" style={styles.icon} />
                    <View style={styles.info}>
                      <Text style={styles.title}>{item.title}</Text>
                      <Text style={styles.subtitle} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
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
                {item.kind === 'group' ? (
                  <TouchableOpacity
                    accessibilityLabel="Delete conversation"
                    style={styles.deleteButton}
                    onPress={() => deleteDateThread(item.id)}
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                ) : (
                  <View />
                )}
              </View>
            )}
            disableRightSwipe
          />
        </>
      )}
    </AppShell>
  );
};

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  search: {
    backgroundColor: '#f0f0f0',
    padding: 10,
    marginHorizontal: 12,
    marginTop: 8,      // pushed up as high as possible
    marginBottom: 6,
    borderRadius: 8,
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

  deleteButton: { padding: 10 },
  deleteText: { color: 'white', fontWeight: 'bold' },

  icon: { marginRight: 12 },
  info: { flex: 1 },

  title: { fontSize: 16, fontWeight: '600', color: '#333' },
  subtitle: { fontSize: 14, color: '#666' },

  badge: {
    backgroundColor: 'red',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
});

export default MessagesScreen;
