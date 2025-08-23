import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, Modal, Alert, Image, FlatList
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import EmojiSelector from 'react-native-emoji-selector';
import * as ImagePicker from 'expo-image-picker';

import AppShell from '@components/AppShell';
import { supabase } from '@config/supabase';

// Crash-safe lazy Notifications (no top-level native import)
let Notifications: any = {
  addNotificationReceivedListener: () => ({ remove() {} }),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  scheduleNotificationAsync: async () => undefined,
  cancelScheduledNotificationAsync: async () => undefined,
  cancelAllScheduledNotificationsAsync: async () => undefined,
  getPermissionsAsync: async () => ({ status: 'undetermined' } as any),
  requestPermissionsAsync: async () => ({ status: 'denied' } as any),
};
if (__DEV__) {
  import('expo-notifications').then((m) => { Notifications = m; }).catch(() => {});
}

type ChatMessage = {
  id: string;
  date_id: string;
  user_id: string;
  content: string;
  created_at: string;
  reply_to?: string | null;
  media_url?: string | null;
  reactions?: Array<{ emoji: string; user_id: string }>;
  type?: 'user' | 'reply' | 'system';
};

const PAGE_SIZE = 20;
const BUCKET = 'chat_media';

const GroupChatScreen = () => {
  const route = useRoute() as any;
  const { dateId } = route.params || {};

  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editMessage, setEditMessage] = useState<ChatMessage | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [mediaUri, setMediaUri] = useState<string>('');
  const [notificationVisible, setNotificationVisible] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage> | null>(null);

  // cache user id
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (mounted) setCurrentUserId(data?.user?.id ?? null);
    })();
    return () => { mounted = false; };
  }, []);

  const groupedReplies = useMemo(() => {
    const acc: Record<string, ChatMessage[]> = {};
    for (const msg of messages) {
      if (msg.reply_to) {
        (acc[msg.reply_to] ||= []).push(msg);
      }
    }
    return acc;
  }, [messages]);

  const highlightMentions = (text: string) => {
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, i) =>
      part.startsWith('@') ? (
        <Text key={i} style={styles.mention}>{part}</Text>
      ) : (
        <Text key={i}>{part}</Text>
      )
    );
  };

  const handleTyping = useCallback(async (text: string) => {
    setInput(text);
    if (!currentUserId) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    await supabase.from('chat_typing').upsert({ user_id: currentUserId, typing: true });
    typingTimeoutRef.current = setTimeout(async () => {
      await supabase.from('chat_typing').upsert({ user_id: currentUserId, typing: false });
    }, 2000);
  }, [currentUserId]);

  const handleEdit = (msg: ChatMessage) => {
    setEditMessage(msg);
    setInput(msg.content);
  };

  const handleDelete = async (id: string) => {
    Alert.alert('Delete Message', 'Are you sure you want to delete this message?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('chat_messages').delete().eq('id', id);
          setMessages(prev => prev.filter(m => m.id !== id));
        },
      },
    ]);
  };

  const renderReactions = (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    const reacts = msg?.reactions || [];
    if (!reacts.length) return null;
    return (
      <Text style={{ marginTop: 4 }}>
        {reacts.map((r, idx) => <Text key={idx} style={{ fontSize: 14 }}>{r.emoji} </Text>)}
      </Text>
    );
  };

  const toggleThread = (id: string) =>
    setExpandedThreads(prev => ({ ...prev, [id]: !prev[id] }));

  const pinMessage = async (id: string) =>
    supabase.from('chat_messages').update({ pinned: true }).eq('id', id);

  const muteUser = async (userId: string) =>
    supabase.from('chat_mutes').insert({ date_id: dateId, user_id: userId });

  const removeUser = async (userId: string) =>
    supabase.from('chat_participants').delete().eq('user_id', userId).eq('date_id', dateId);

  const fetchMessages = useCallback(async (beforeTimestamp: string | null = null) => {
    let q = supabase
      .from('chat_messages')
      .select('*')
      .eq('date_id', dateId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (beforeTimestamp) q = q.lt('created_at', beforeTimestamp);

    const { data, error } = await q;
    if (!error && data) setMessages(prev => [...data.reverse(), ...prev]);
  }, [dateId]);

  // startup: cleanup old media, hydrate, subscribe
  useEffect(() => {
    let mounted = true;

    (async () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('chat_messages')
        .select('id, media_url, created_at')
        .lt('created_at', twoDaysAgo)
        .not('media_url', 'is', null);

      if (mounted && data?.length) {
        for (const msg of data) {
          try {
            const filename = msg.media_url!.split('/').pop()!;
            await supabase.storage.from(BUCKET).remove([filename]);
            await supabase.from('chat_messages').delete().eq('id', msg.id);
          } catch {}
        }
      }

      await fetchMessages();

      const channel = supabase
        .channel(`chat_${dateId}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_messages' },
          payload => {
            if (payload.new.date_id === dateId) {
              setMessages(prev => [...prev, payload.new as any]);
              flatListRef.current?.scrollToEnd?.({ animated: true });
            }
          }
        )
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'chat_typing' },
          payload => {
            const { user_id, typing } = payload.new as any;
            if (!currentUserId || user_id === currentUserId) return;
            setTypingUsers(prev => typing
              ? [...new Set([...prev, user_id])]
              : prev.filter(id => id !== user_id)
            );
          }
        )
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_reactions' },
          payload => {
            const r = payload.new as any;
            setMessages(prev =>
              prev.map(m => m.id === r.message_id
                ? { ...m, reactions: [...(m.reactions || []), r] }
                : m
              )
            );
          }
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    })();

    return () => { mounted = false; };
  }, [dateId, currentUserId, fetchMessages]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) setMediaUri(result.assets[0].uri);
  };

  const uploadMediaIfAny = async (): Promise<string> => {
    if (!mediaUri) return '';
    const filename = `${Date.now()}_${mediaUri.split('/').pop()}`;
    const res = await fetch(mediaUri);
    const blob = await res.blob();
    const { data, error } = await supabase.storage.from(BUCKET).upload(filename, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error || !data) return '';
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
    return pub?.publicUrl ?? '';
  };

  const sendMessage = async () => {
    if (!currentUserId || !input.trim()) return;

    const mediaUrl = await uploadMediaIfAny();

    const payload = {
      content: input.trim(),
      user_id: currentUserId,
      date_id: dateId,
      reply_to: replyTo?.id || null,
      read_by: [currentUserId],
      type: replyTo ? 'reply' : 'user',
      media_url: mediaUrl || null,
    };

    const { data: inserted, error } = await supabase
      .from('chat_messages')
      .insert(payload)
      .select();

    if (!error && inserted && inserted[0]) {
      // optional: your server push (dev only while prod push is killed)
      // await sendPushNotification('New Message', `${currentUserId}: ${payload.content}`);
      setMessages(prev => [...prev, inserted[0] as any]);
    }
    setInput('');
    setReplyTo(null);
    setMediaUri('');
  };

  const renderThread = (parent: ChatMessage) => {
    const replies = groupedReplies[parent.id] || [];
    const expanded = expandedThreads[parent.id];
    const showActions = parent.user_id === currentUserId;

    if (parent.type === 'system') {
      return (
        <Text style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', marginVertical: 8 }}>
          {parent.content}
        </Text>
      );
    }

    return (
      <Animated.View entering={FadeInUp} style={styles.messageBubble}>
        <TouchableOpacity
          onLongPress={() => setReactionPicker({ messageId: parent.id, visible: true })}
          onPress={() => toggleThread(parent.id)}
          activeOpacity={0.8}
        >
          <Text style={styles.messageText}>{highlightMentions(parent.content)}</Text>

          {!!parent.media_url && (
            <TouchableOpacity
              onPress={() => setProfileModal({ visible: true, profile: { screenname: 'Image Viewer', image: parent.media_url } })}
              activeOpacity={0.9}
              style={{ marginTop: 8 }}
            >
              <Image source={{ uri: parent.media_url }} style={{ width: '100%', height: 180, borderRadius: 10 }} />
              {showActions && (
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert('Delete Media', 'Are you sure you want to delete this media?', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete', style: 'destructive',
                        onPress: async () => {
                          const filename = parent.media_url!.split('/').pop()!;
                          await supabase.storage.from(BUCKET).remove([filename]);
                          await supabase.from('chat_messages').delete().eq('id', parent.id);
                          fetchMessages();
                        },
                      },
                    ]);
                  }}
                >
                  <Text style={{ color: '#d00', fontSize: 12, marginTop: 4 }}>🗑 Delete Media</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}

          <Text style={styles.timestamp}>{new Date(parent.created_at).toLocaleTimeString()}</Text>
          <Text style={styles.replyTap}>💬 Reply ({replies.length})</Text>
          {renderReactions(parent.id)}
        </TouchableOpacity>

        {showActions && (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
            <TouchableOpacity onPress={() => handleEdit(parent)}><Text style={styles.edit}>✏️ Edit</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(parent.id)}><Text style={styles.delete}>🗑 Delete</Text></TouchableOpacity>
          </View>
        )}

        {/* Admin tools (set your own rule) */}
        {true && (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
            <TouchableOpacity onPress={() => handlePin(parent.id)}><Text style={styles.edit}>📌 Pin</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => handleMute(parent.user_id)}><Text style={styles.delete}>🔇 Mute</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => removeUser(parent.user_id)}><Text style={styles.delete}>❌ Remove</Text></TouchableOpacity>
          </View>
        )}

        {expanded && replies.map(reply => (
          <View key={reply.id} style={styles.replyIndented}>
            <TouchableOpacity onLongPress={() => setReactionPicker({ messageId: reply.id, visible: true })}>
              <Text style={styles.replyHint}>↩️ {highlightMentions(reply.content)}</Text>
              <Text style={styles.timestamp}>{new Date(reply.created_at).toLocaleTimeString()}</Text>
              <Text style={styles.replyTap} onPress={() => setReplyTo(reply)}>💬 Reply</Text>
              {renderReactions(reply.id)}
            </TouchableOpacity>

            {reply.user_id === currentUserId && (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
                <TouchableOpacity onPress={() => handleEdit(reply)}><Text style={styles.edit}>✏️ Edit</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(reply.id)}><Text style={styles.delete}>🗑 Delete</Text></TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </Animated.View>
    );
  };

  const [reactionPicker, setReactionPicker] = useState<{ messageId: string; visible: boolean }>({ messageId: '', visible: false });
  const [profileModal, setProfileModal] = useState<{ visible: boolean; profile: any | null }>({ visible: false, profile: null });

  const addReaction = async (messageId: string, emoji: string) => {
    if (!currentUserId) return;
    await supabase.from('chat_reactions').upsert({ message_id: messageId, user_id: currentUserId, emoji });
    setReactionPicker({ messageId: '', visible: false });
  };

  const handlePin = (id: string) =>
    Alert.alert('Pin Message', 'Pin this message for everyone to see?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pin', onPress: () => pinMessage(id) },
    ]);

  const handleMute = (userId: string) =>
    Alert.alert('Mute User', 'Mute this user in chat?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mute', onPress: () => muteUser(userId) },
    ]);

  const onModalMarkRead = async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications(curr => curr.filter(n => n.id !== id));
  };

  return (
    <AppShell currentTab="Vibe">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        {typingUsers.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Text style={{ color: '#888', fontStyle: 'italic' }}>
              {typingUsers.length === 1 ? 'Someone is typing...' : 'Several people are typing...'}
            </Text>
          </View>
        )}

        <TextInput
          style={{ backgroundColor: '#f0f0f0', padding: 10, margin: 12, borderRadius: 8 }}
          placeholder="Search messages..."
          value={search}
          onChangeText={setSearch}
        />

        <FlatList
          ref={flatListRef}
          data={messages.filter(m => !m.reply_to && (m.content || '').toLowerCase().includes(search.toLowerCase()))}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => renderThread(item)}
          contentContainerStyle={{ padding: 12 }}
          onEndReached={() => {
            const oldest = messages[0];
            if (oldest) fetchMessages(oldest.created_at);
          }}
          onEndReachedThreshold={0.1}
        />

        {replyTo && (
          <View style={styles.replyBox}>
            <Text style={styles.replyingText}>Replying to: {replyTo.content}</Text>
            <Text style={styles.cancelReply} onPress={() => setReplyTo(null)}>✖ Cancel</Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <TouchableOpacity onPress={() => setShowEmoji(!showEmoji)}>
            <Text style={styles.emojiToggle}>😀</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={pickImage}>
            <Text style={styles.emojiToggle}>📷</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Type something brilliant..."
            value={input}
            onChangeText={handleTyping}
          />
          <TouchableOpacity onPress={sendMessage} style={styles.sendBtn}>
            <Text style={styles.sendText}>{editMessage ? 'Update' : 'Send'}</Text>
          </TouchableOpacity>
        </View>

        {showEmoji && (
          <EmojiSelector
            onEmojiSelected={(emoji: string) => setInput(prev => prev + emoji)}
            showSearchBar={false}
            showTabs
          />
        )}

        {/* Reaction picker */}
        <Modal visible={reactionPicker.visible} transparent animationType="fade">
          <TouchableOpacity
            style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
            onPress={() => setReactionPicker({ messageId: '', visible: false })}
          >
            <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 16 }}>
              <Text style={{ fontWeight: '700', marginBottom: 12 }}>React with:</Text>
              <View style={{ flexDirection: 'row' }}>
                {['❤️', '😂', '🔥', '👍', '👀'].map(emoji => (
                  <TouchableOpacity key={emoji} onPress={() => addReaction(reactionPicker.messageId, emoji)}>
                    <Text style={{ fontSize: 24, marginHorizontal: 8 }}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Simple notifications modal (local list) */}
        <NotificationModal
          visible={notificationVisible}
          onClose={() => setNotificationVisible(false)}
          notifications={notifications}
          onMarkRead={onModalMarkRead}
        />
      </KeyboardAvoidingView>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  messageBubble: { backgroundColor: '#f2f2f2', padding: 12, borderRadius: 12, marginBottom: 12 },
  messageText: { fontSize: 16 },
  mention: { fontSize: 16, color: '#ff5a5f', fontWeight: '700' },
  timestamp: { fontSize: 12, color: '#888', marginTop: 4 },
  replyTap: { fontSize: 12, color: '#007AFF', marginTop: 4 },
  replyHint: { fontSize: 13, color: '#555', marginBottom: 4, fontStyle: 'italic' },
  replyBox: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff0f0' },
  replyingText: { color: '#ff5a5f' },
  cancelReply: { color: '#999', fontStyle: 'italic' },
  inputRow: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  emojiToggle: { fontSize: 24, marginRight: 8 },
  input: { flex: 1, height: 40, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 10 },
  sendBtn: { backgroundColor: '#ff5a5f', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, marginLeft: 8 },
  sendText: { color: '#fff', fontWeight: '600' },
  replyIndented: { backgroundColor: '#e9e9e9', padding: 10, borderRadius: 10, marginTop: 6, marginLeft: 16 },
  edit: { marginHorizontal: 8, color: '#555' },
  delete: { marginHorizontal: 8, color: '#d00' },
});

const NotificationModal = ({
  visible, onClose, notifications, onMarkRead,
}: {
  visible: boolean;
  onClose: () => void;
  notifications: any[];
  onMarkRead: (id: string) => Promise<void>;
}) => (
  <Modal visible={visible} transparent animationType="fade">
    <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose}>
      <View style={{ marginTop: 100, marginHorizontal: 40, backgroundColor: '#fff', borderRadius: 10, padding: 20 }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Notifications</Text>
        {notifications.length === 0 ? (
          <Text style={{ color: '#888' }}>No notifications</Text>
        ) : (
          notifications.map((n, i) => (
            <TouchableOpacity key={i} onPress={() => onMarkRead(n.id)}>
              <Text style={{ marginBottom: 6 }}>{n.message}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </TouchableOpacity>
  </Modal>
);

export default GroupChatScreen;
