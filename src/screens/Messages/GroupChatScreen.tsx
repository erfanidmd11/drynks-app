// src/screens/Messages/GroupChatScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeInUp } from 'react-native-reanimated';

import AppShell from '@components/AppShell';
import { supabase } from '@config/supabase';
import Avatar from '../../ui/Avatar';

type UUID = string;
type RouteParams = { dateId: UUID; origin?: string };

type DateRow = {
  id: UUID;
  title: string | null;
  event_date: string | null;
  event_timezone: string | null;
  creator: UUID;
  accepted_users: UUID[] | null;
};

type Profile = { id: UUID; screenname: string | null; profile_photo: string | null };

type ChatMessage = {
  id: UUID;
  room_id?: UUID | null;            // ← supports room-based chats (group)
  date_id: UUID | null;             // ← kept for backward compatibility
  sender_id: UUID | null;
  content: string | null;
  created_at: string;
  reply_to: UUID | null;
  media_url: string | null;
  type: 'user' | 'media' | string | null;
};

const BUCKET = 'chat-media';
const MAX_VIDEO_SEC = 30;

/* ------------------------- helpers (event timing) ------------------------- */
function getYMDInTZ(date: Date, tz?: string | null) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  let y = 0,
    m = 0,
    d = 0;
  for (const p of parts) {
    if (p.type === 'year') y = +p.value;
    if (p.type === 'month') m = +p.value;
    if (p.type === 'day') d = +p.value;
  }
  return { y, m, d };
}

function isChatLocked(eventISO?: string | null, tz?: string | null) {
  if (!eventISO) return false;
  try {
    const ev = new Date(eventISO);
    const e = getYMDInTZ(ev, tz);
    const n = getYMDInTZ(new Date(), tz);
    // lock after end-of-next-day -> when n > e + 1
    const eNum = e.y * 10000 + e.m * 100 + e.d + 1;
    const nNum = n.y * 10000 + n.m * 100 + n.d;
    return nNum > eNum;
  } catch {
    return false;
  }
}

/* ------------------------------- main screen ------------------------------ */
const GroupChatScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { dateId } = (route.params || {}) as RouteParams;

  const [me, setMe] = useState<UUID | null>(null);

  const [date, setDate] = useState<DateRow | null>(null);
  const [people, setPeople] = useState<Map<UUID, Profile>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  // manage modal for participants removal (host only)
  const [manageOpen, setManageOpen] = useState(false);

  // Rooms support (if you’ve created chat_rooms + ensure_event_room RPC)
  const [roomId, setRoomId] = useState<UUID | null>(null);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const chMsgsRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const locked = useMemo(
    () => isChatLocked(date?.event_date, date?.event_timezone),
    [date?.event_date, date?.event_timezone]
  );
  const participantIds = useMemo(() => {
    if (!date) return [];
    const arr = new Set<UUID>([date.creator, ...(date.accepted_users || [])]);
    return Array.from(arr);
  }, [date]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  /* ------------------------------ initial load ----------------------------- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setMe(data?.session?.user?.id ?? null);
    })();
  }, []);

  // If RPC exists, this will resolve a room for the event; if not, it silently no-ops.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('ensure_event_room', { p_date_id: dateId });
        if (!error && data && !cancelled) setRoomId(data as UUID);
      } catch {
        // ignore if RPC not deployed; we'll keep using date_id flow
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateId]);

  const loadDateAndPeople = useCallback(async () => {
    const { data: d } = await supabase
      .from('date_requests')
      .select('id, title, event_date, event_timezone, creator, accepted_users')
      .eq('id', dateId)
      .maybeSingle();
    setDate(d as DateRow | null);

    const ids = new Set<UUID>();
    if (d?.creator) ids.add(d.creator);
    (d?.accepted_users || []).forEach((u: UUID) => ids.add(u));
    if (ids.size) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, screenname, profile_photo')
        .in('id', Array.from(ids));
      const map = new Map<UUID, Profile>();
      (profs || []).forEach((p: any) =>
        map.set(p.id, { id: p.id, screenname: p.screenname, profile_photo: p.profile_photo })
      );
      setPeople(map);
    } else {
      setPeople(new Map());
    }
  }, [dateId]);

  const loadMessages = useCallback(async () => {
    const column = roomId ? 'room_id' : 'date_id';
    const value = (roomId ?? dateId) as UUID;

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, room_id, date_id, sender_id, content, created_at, reply_to, media_url, type')
      .eq(column, value)
      .order('created_at', { ascending: true });

    if (!error) {
      setMessages((data || []) as ChatMessage[]);
      scrollToEnd();
    }
  }, [dateId, roomId, scrollToEnd]);

  // unread → mark seen (keeps your existing structure that keys by date_id)
  const markSeen = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id as UUID | undefined;
      if (!uid) return;
      await supabase
        .from('chat_seen')
        .upsert({ date_id: dateId, user_id: uid, last_seen: new Date().toISOString() });
    } catch {}
  }, [dateId]);

  // live updates
  const attachRealtime = useCallback(() => {
    try {
      chMsgsRef.current?.unsubscribe();
    } catch {}
    const filterCol = roomId ? 'room_id' : 'date_id';
    const filterVal = (roomId ?? dateId) as UUID;

    chMsgsRef.current = supabase
      .channel(`chat:${filterVal}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `${filterCol}=eq.${filterVal}` },
        (payload: any) => {
          const msg = payload?.new as ChatMessage;
          setMessages(prev => [...prev, msg]);
          scrollToEnd();
          markSeen();
        }
      )
      .subscribe(() => {});
  }, [dateId, roomId, scrollToEnd, markSeen]);

  useEffect(() => {
    loadDateAndPeople();
    loadMessages();
    attachRealtime();
    return () => {
      try {
        chMsgsRef.current?.unsubscribe();
      } catch {}
    };
  }, [loadDateAndPeople, loadMessages, attachRealtime]);

  useFocusEffect(
    React.useCallback(() => {
      markSeen();
      return () => {};
    }, [markSeen])
  );

  /* ------------------------------ send content ----------------------------- */

  const sendPushForMessage = async (m: ChatMessage) => {
    // Non-blocking; wire this to your Edge Function or notifications table.
    try {
      await supabase.from('notifications').insert([
        {
          user_id: null, // fill if you notify per-user
          message: 'New chat message',
          screen: 'GroupChat',
          params: { date_id: m.date_id, room_id: m.room_id, message_id: m.id },
        },
      ]);
    } catch {}
  };

  const uploadMedia = async (): Promise<{ media_url: string; type: 'image' | 'video' } | null> => {
    setPickerBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 0.85,
        videoMaxDuration: MAX_VIDEO_SEC,
      });
      if (res.canceled || !res.assets?.length) return null;

      const asset = res.assets[0];
      const isVideo = asset.type?.startsWith('video');
      const fileUri = asset.uri;
      const fileExt = isVideo ? 'mp4' : 'jpg';
      const prefix = (roomId ?? dateId) as UUID;
      const path = `${prefix}/${me}/${Date.now()}.${fileExt}`;

      const file = await fetch(fileUri).then(r => r.blob());
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          upsert: false,
          contentType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        });
      if (error) throw error;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
      return { media_url: pub.publicUrl, type: isVideo ? 'video' : 'image' };
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload media.');
      return null;
    } finally {
      setPickerBusy(false);
    }
  };

  const sendText = useCallback(async () => {
    const body = text.trim();
    if (!body || !dateId || !me) return;
    setSending(true);
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          room_id: roomId ?? null,          // new rooms flow
          date_id: roomId ? null : dateId,  // legacy flow
          sender_id: me,
          content: body,
          reply_to: replyTo?.id ?? null,
          type: 'user',
        })
        .select('*')
        .single();
      if (error) throw error;
      setText('');
      setReplyTo(null);
      scrollToEnd();
      markSeen();
      await sendPushForMessage(data as ChatMessage);
    } catch (e: any) {
      Alert.alert('Send failed', e?.message || 'Try again later.');
    } finally {
      setSending(false);
    }
  }, [dateId, roomId, me, text, replyTo, scrollToEnd, markSeen]);

  const sendAttachment = useCallback(async () => {
    const uploaded = await uploadMedia();
    if (!uploaded || !me) return;
    setSending(true);
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          room_id: roomId ?? null,
          date_id: roomId ? null : dateId,
          sender_id: me,
          content: uploaded.type === 'image' ? '[photo]' : '[video]',
          media_url: uploaded.media_url,
          reply_to: replyTo?.id ?? null,
          type: 'media',
        })
        .select('*')
        .single();
      if (error) throw error;
      setReplyTo(null);
      scrollToEnd();
      markSeen();
      await sendPushForMessage(data as ChatMessage);
    } catch (e: any) {
      Alert.alert('Send failed', e?.message || 'Try again later.');
    } finally {
      setSending(false);
    }
  }, [dateId, roomId, me, replyTo, scrollToEnd, markSeen]);

  /* ------------------------------ participants ----------------------------- */

  const isHost = useMemo(() => !!(me && date && me === date.creator), [me, date]);

  const removeParticipant = async (userId: UUID) => {
    if (!date || !isHost) return;
    Alert.alert('Remove from date?', 'They will be removed from the chat and the event.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const next = (date.accepted_users || []).filter(u => u !== userId);
            const { error } = await supabase
              .from('date_requests')
              .update({ accepted_users: next })
              .eq('id', date.id);
            if (error) throw error;
            await loadDateAndPeople();
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not remove the user.');
          }
        },
      },
    ]);
  };

  /* --------------------------------- render -------------------------------- */

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const mine = me && item.sender_id === me;
    const prev = messages[index - 1];
    const sameAsPrev = prev && prev.sender_id === item.sender_id;

    const senderProfile = item.sender_id ? people.get(item.sender_id) : null;
    const name = senderProfile?.screenname || 'User';
    const avatarUrl = senderProfile?.profile_photo || undefined;

    return (
      <Animated.View
        entering={FadeInUp}
        style={[styles.msgRow, mine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}
      >
        {!mine && !sameAsPrev ? (
          <Avatar url={avatarUrl} size={26} />
        ) : (
          !mine && sameAsPrev && <View style={[styles.avatar, { opacity: 0 }]} />
        )}

        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          {!mine && !sameAsPrev ? <Text style={styles.senderName}>{name}</Text> : null}

          {item.reply_to ? (
            <View style={styles.replyBox}>
              {(() => {
                const ref = messages.find(m => m.id === item.reply_to);
                const sn = ref?.sender_id ? people.get(ref.sender_id!)?.screenname || 'User' : 'User';
                return (
                  <>
                    <Text style={styles.replySender}>{sn}</Text>
                    <Text numberOfLines={2} style={styles.replyText}>
                      {ref?.content || (ref?.media_url ? '[media]' : '')}
                    </Text>
                  </>
                );
              })()}
            </View>
          ) : null}

          {item.media_url ? (
            item.type === 'media' && item.content === '[video]' ? (
              <Video source={{ uri: item.media_url }} style={styles.media} useNativeControls resizeMode="cover" />
            ) : (
              <Image source={{ uri: item.media_url }} style={styles.media} />
            )
          ) : null}

          {item.content ? <Text style={styles.msgText}>{item.content}</Text> : null}

          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            {!mine ? (
              <TouchableOpacity onPress={() => setReplyTo(item)} style={{ marginLeft: 8 }}>
                <Ionicons name="return-up-back" size={16} color="#888" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Animated.View>
    );
  };

  const headerRight = (
    <TouchableOpacity onPress={() => setManageOpen(true)} disabled={!isHost} style={{ opacity: isHost ? 1 : 0.35 }}>
      <Ionicons name="people-outline" size={22} color="#111" />
    </TouchableOpacity>
  );

  return (
    <AppShell headerTitle={date?.title || 'Chat'} showBack rightAccessory={headerRight} currentTab={undefined}>
      {/* participants row */}
      <View style={styles.participants}>
        {participantIds.slice(0, 8).map(id => {
          const p = people.get(id);
          return (
            <View key={id} style={styles.participant}>
              <Avatar url={p?.profile_photo || undefined} size={32} />
            </View>
          );
        })}
        {participantIds.length > 8 ? (
          <View style={[styles.participant, styles.moreCount]}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>+{participantIds.length - 8}</Text>
          </View>
        ) : null}
      </View>

      {/* messages */}
      {!messages.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {date ? (
            locked ? (
              <Text style={{ color: '#666', textAlign: 'center' }}>
                This chat is now read‑only. You can still view past messages.
              </Text>
            ) : (
              <Text style={{ color: '#666', textAlign: 'center' }}>No messages yet — say hi 👋</Text>
            )
          ) : (
            <ActivityIndicator />
          )}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 10 }}
          onContentSizeChange={scrollToEnd}
          onScrollEndDrag={markSeen}
        />
      )}

      {/* composer */}
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        keyboardVerticalOffset={Platform.select({ ios: 84, android: 0 })}
      >
        {replyTo ? (
          <View style={styles.replyBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.replyLabel}>Replying to</Text>
              <Text numberOfLines={2} style={styles.replyPreview}>
                {replyTo.content || (replyTo.media_url ? '[media]' : '')}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Ionicons name="close-circle" size={20} color="#888" />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={[styles.inputRow, locked && { opacity: 0.5 }]}>
          <TouchableOpacity onPress={sendAttachment} disabled={locked || pickerBusy} style={styles.attachBtn}>
            <Ionicons name="image-outline" size={22} color="#444" />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={locked ? 'Chat closed' : 'Message'}
            value={text}
            onChangeText={setText}
            multiline
            editable={!locked && !sending}
          />
          <TouchableOpacity onPress={sendText} disabled={locked || sending || !text.trim()} style={styles.sendBtn}>
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* manage participants (host) */}
      <Modal visible={manageOpen} transparent animationType="fade" onRequestClose={() => setManageOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Participants</Text>
            {participantIds.map(id => {
              const p = people.get(id);
              const canRemove = isHost && id !== date?.creator;
              return (
                <View key={id} style={styles.rowUser}>
                  <Avatar url={p?.profile_photo || undefined} size={30} />
                  <Text style={styles.rowName} numberOfLines={1}>
                    {p?.screenname || 'User'}
                  </Text>
                  {canRemove ? (
                    <TouchableOpacity onPress={() => removeParticipant(id)} style={styles.removeBtn}>
                      <Ionicons name="remove-circle" size={20} color="#E34E5C" />
                    </TouchableOpacity>
                  ) : (
                    <View style={{ width: 20 }} />
                  )}
                </View>
              );
            })}
            <TouchableOpacity onPress={() => setManageOpen(false)} style={styles.closeBtn}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  participants: { flexDirection: 'row', padding: 10, paddingTop: 4, gap: 6, alignItems: 'center' },
  participant: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', borderColor: '#fff', borderWidth: 1 },
  participantAvatar: { width: '100%', height: '100%' },
  moreCount: { backgroundColor: '#999', alignItems: 'center', justifyContent: 'center' },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8, gap: 6 },
  avatar: { width: 26, height: 26, borderRadius: 13, marginRight: 6 },
  bubble: { maxWidth: '78%', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
  bubbleMine: { backgroundColor: '#EAF7EE', marginLeft: 40 },
  bubbleOther: { backgroundColor: '#fff', marginRight: 40, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  senderName: { fontSize: 11, fontWeight: '700', color: '#333', marginBottom: 2 },
  msgText: { color: '#222', fontSize: 15 },

  media: { width: 220, height: 220, borderRadius: 10, marginBottom: 6 },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  meta: { fontSize: 11, color: '#7a7a7a' },

  replyBox: {
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderLeftWidth: 3,
    borderLeftColor: '#9ac4ff',
    padding: 6,
    borderRadius: 8,
    marginBottom: 6,
  },
  replySender: { fontSize: 11, fontWeight: '700', color: '#333' },
  replyText: { fontSize: 12, color: '#444' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    gap: 8,
    backgroundColor: '#F7F8FA',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  attachBtn: { padding: 8 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  sendBtn: { backgroundColor: '#E34E5C', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },

  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff3c9',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f1da93',
  },
  replyLabel: { fontWeight: '800', color: '#9a6b00', fontSize: 12 },
  replyPreview: { color: '#6d5d00', fontSize: 12 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#111', marginBottom: 10 },
  rowUser: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowAvatar: { width: 30, height: 30, borderRadius: 15 },
  rowName: { flex: 1, color: '#222', fontWeight: '600' },
  removeBtn: { padding: 6 },
  closeBtn: { backgroundColor: '#111', marginTop: 12, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
});

export default GroupChatScreen;
