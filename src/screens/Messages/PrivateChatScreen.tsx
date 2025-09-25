// src/screens/Messages/PrivateChatScreen.tsx
// Production-ready 1:1 chat with typing indicator, image upload, replies, edit/delete,
// Supabase Storage upload (RN-safe), and notification enqueue. Expo SDK 54 / RN 0.81.

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import EmojiSelector from 'react-native-emoji-selector';
import Animated, { FadeInUp } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Avatar from '../../ui/Avatar';

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#E1EBF2';
const DRYNKS_WHITE = '#FFFFFF';

const DAILY_LIMIT = 3;
const CHAT_BUCKET = 'chat-media';

type ChatMessage = {
  id: string | number;
  user_id: string;
  recipient_id: string;
  content: string | null;
  media_url?: string | null;
  type?: 'system' | 'user';
  reply_to?: string | number | null;
  created_at: string;
  date_id?: string | null;
  event_date?: string | null;
};

const PrivateChatScreen: React.FC = () => {
  const route = useRoute<any>();
  const { otherUserId } = route.params ?? {};

  // state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [chatAllowed, setChatAllowed] = useState(true);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editMessage, setEditMessage] = useState<ChatMessage | null>(null);
  const [expiresSoon, setExpiresSoon] = useState(false);
  const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
  const [mediaUri, setMediaUri] = useState('');

  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // current user id (cache)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setCurrentUserId(data?.user?.id ?? null);
    })();
  }, []);

  // other user's profile (avatar)
  const [otherProfile, setOtherProfile] = useState<{
    id: string;
    screenname: string | null;
    profile_photo: string | null;
  } | null>(null);

  useEffect(() => {
    if (!otherUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, screenname, profile_photo')
          .eq('id', otherUserId)
          .single();
        if (!cancelled) setOtherProfile((data || null) as any);
      } catch {
        // no-op
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [otherUserId]);

  // helpers
  const pairMatches = useCallback(
    (m: ChatMessage, me: string, other: string) =>
      (m.user_id === me && m.recipient_id === other) ||
      (m.user_id === other && m.recipient_id === me),
    []
  );

  const checkChatLimit = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const me = userData?.user?.id;
    if (!me) return;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', me)
      .gte('created_at', since);

    if ((count ?? 0) >= DAILY_LIMIT) setChatAllowed(false);
  }, []);

  const insertJoinSystemMessage = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const me = userData?.user?.id;
    const screenname = userData?.user?.user_metadata?.screenname || 'Someone';
    if (!me) return;

    const exists = messages.some((m) => m.user_id === me && m.type === 'system');
    if (!exists) {
      try {
        await supabase.from('chat_messages').insert({
          user_id: me,
          recipient_id: otherUserId,
          content: `🥂 ${screenname} just joined the chat. Let the pregame begin!`,
          type: 'system',
        } as any);
      } catch {
        // ignore
      }
    }
  }, [messages, otherUserId]);

  const fetchMessages = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const me = sessionData?.session?.user?.id;
    if (!me || !otherUserId) {
      return;
    }

    // mark seen for this conversation
    try {
      await supabase.from('chat_seen').upsert({
        user_id: me,
        date_id: null,
        recipient_id: otherUserId,
        last_seen: new Date().toISOString(),
      } as any);
    } catch {
      // no-op
    }

    // only messages between the two users
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .or(
        `and(user_id.eq.${me},recipient_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},recipient_id.eq.${me})`
      )
      .order('created_at');

    if (!error && Array.isArray(data)) {
      const rows = data as ChatMessage[];
      setMessages(rows);

      // optional: if your schema carries an event_date
      const anyEventDate = rows.find((m) => m.event_date)?.event_date;
      if (anyEventDate && new Date(anyEventDate) < new Date(Date.now() + 24 * 60 * 60 * 1000)) {
        setExpiresSoon(true);
      }
    }
  }, [otherUserId]);

  // subscribe realtime
  useEffect(() => {
    (async () => {
      await checkChatLimit();
      await insertJoinSystemMessage();
      await fetchMessages();

      const channel = supabase
        .channel('private-chat-realtime')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_messages' },
          (payload) => {
            const msg = payload.new as ChatMessage;
            if (!currentUserId) return;
            if (pairMatches(msg, currentUserId, otherUserId)) {
              setMessages((prev) => [...prev, msg]);
              flatListRef.current?.scrollToEnd?.({ animated: true });
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'chat_typing' },
          (payload) => {
            const { user_id, typing } = payload.new as { user_id: string; typing: boolean };
            if (user_id === otherUserId) setIsOtherUserTyping(typing);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, otherUserId]);

  // typing indicator
  const handleTyping = async (text: string) => {
    setInput(text);
    const { data } = await supabase.auth.getUser();
    const me = data?.user?.id;
    if (!me) return;

    try {
      await supabase.from('chat_typing').upsert({ user_id: me, typing: true } as any);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(async () => {
        try {
          await supabase.from('chat_typing').upsert({ user_id: me, typing: false } as any);
        } catch {
          // no-op
        }
      }, 2000);
    } catch {
      // no-op
    }
  };

  // Image picker (SDK 54 API) — treat iOS "limited" access as acceptable
  const pickImage = async () => {
    let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      perm = await ImagePicker.requestMediaLibraryPermissionsAsync(); // no options in SDK 54
    }
    const grantedOrLimited = perm.granted || (perm as any).accessPrivileges === 'limited';
    if (!grantedOrLimited) {
      Alert.alert('Permission required', 'We need access to your photos to continue.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      allowsMultipleSelection: false,
    });

    if (!result.canceled && result.assets?.length) {
      setMediaUri(result.assets[0].uri);
    }
  };

  // Normalize -> JPEG and upload to Supabase Storage; returns public URL or ''
  const uploadMediaIfAny = async (): Promise<string> => {
    if (!mediaUri) return '';

    // Normalize/resize to avoid HEIC/WebP/ph:// issues
    const manipulated = await ImageManipulator.manipulateAsync(
      mediaUri,
      [{ resize: { width: 1280 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );

    // In Expo 54 / RN 0.81, fetch(file://...) → Blob works reliably.
    let blob: Blob;
    try {
      const res = await fetch(manipulated.uri);
      blob = (await res.blob()) as Blob;
    } catch {
      Alert.alert('Upload failed', 'Could not read the selected image.');
      return '';
    }

    const fileName = `${Date.now()}_${(manipulated.uri.split('/').pop() || 'image')}.jpg`;

    const { data, error } = await supabase.storage
      .from(CHAT_BUCKET)
      .upload(fileName, blob, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '3600',
      });

    if (error || !data) return '';

    const { data: pub } = supabase.storage.from(CHAT_BUCKET).getPublicUrl(data.path);
    return pub?.publicUrl ?? '';
  };

  const sendMessage = async () => {
    if (!chatAllowed) {
      Alert.alert('Limit Reached', 'You’ve opened 3 private chats today. Upgrade to unlock more.');
      return;
    }
    if (!input.trim() && !mediaUri) return;

    const { data: userData } = await supabase.auth.getUser();
    const me = userData?.user?.id;
    if (!me) return;

    const mediaUrl = await uploadMediaIfAny();

    try {
      if (editMessage) {
        await supabase
          .from('chat_messages')
          .update({ content: input.trim(), media_url: mediaUrl || null })
          .eq('id', editMessage.id);
        setEditMessage(null);
        setInput('');
        setMediaUri('');
        await fetchMessages();
        return;
      }

      await supabase.from('chat_messages').insert({
        content: input.trim() || null,
        user_id: me,
        recipient_id: otherUserId,
        reply_to: replyTo?.id ?? null,
        media_url: mediaUrl || null,
        type: 'user',
      } as any);

      setInput('');
      setMediaUri('');
      setReplyTo(null);

      // enqueue a lightweight notification row (match your schema)
      await supabase.from('notifications').insert({
        user_id: otherUserId,
        type: 'generic',
        title: 'New message',
        body: `${userData?.user?.user_metadata?.screenname || 'Someone'} sent you a message`,
        data: { screen: 'PrivateChat', params: { otherUserId } },
        read_at: null,
      } as any);

      // stop typing
      try {
        await supabase.from('chat_typing').upsert({ user_id: me, typing: false } as any);
      } catch {}
    } catch (e) {
      Alert.alert('Send failed', 'Please try again.');
    }
  };

  const scrollToMessage = (id: string | number) => {
    const idx = messages.findIndex((m) => m.id === id);
    if (idx !== -1) flatListRef.current?.scrollToIndex?.({ index: idx, animated: true });
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isOwn = !!currentUserId && item.user_id === currentUserId;

    return (
      <View
        style={[
          styles.msgRow,
          isOwn ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' },
        ]}
      >
        {!isOwn && (
          <Avatar
            url={otherProfile?.profile_photo || undefined}
            size={26}
            style={{ marginRight: 6 }}
          />
        )}

        <Animated.View entering={FadeInUp} style={[styles.messageBubble, isOwn && styles.messageBubbleOwn]}>
          {item.reply_to && (
            <Text style={styles.replyHint}>
              ↩️ Replying to: {messages.find((m) => m.id === item.reply_to)?.content}
              <Text onPress={() => scrollToMessage(item.reply_to!)} style={{ color: DRYNKS_BLUE }}>
                {' '}
                [Jump]
              </Text>
            </Text>
          )}

          {!!item.content && <Text style={styles.messageText}>{item.content}</Text>}
          {!!item.media_url && <Image source={{ uri: item.media_url }} style={styles.image} />}

          <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleTimeString()}</Text>

          {item.type !== 'system' && (
            <Text style={styles.replyTap} onPress={() => setReplyTo(item)}>
              💬 Reply
            </Text>
          )}

          {isOwn && item.type !== 'system' && (
            <View style={styles.actions}>
              <Text
                style={styles.edit}
                onPress={() => {
                  setInput(item.content ?? '');
                  setEditMessage(item);
                }}
              >
                ✏️ Edit
              </Text>

              <Text
                style={styles.delete}
                onPress={() => {
                  Alert.alert('Delete Message', 'Are you sure?', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          if (item.media_url) {
                            // remove by filename if uploaded at bucket root
                            const filename = item.media_url.split('/').pop();
                            if (filename) await supabase.storage.from(CHAT_BUCKET).remove([filename]);
                          }
                          await supabase.from('chat_messages').delete().eq('id', item.id);
                          await fetchMessages();
                        } catch (e) {
                          console.warn('[PrivateChat] delete failed', e);
                        }
                      },
                    },
                  ]);
                }}
              >
                🗑 Delete
              </Text>
            </View>
          )}
        </Animated.View>
      </View>
    );
  };

  return (
    <AppShell currentTab="Vibe">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {expiresSoon && (
          <View style={{ backgroundColor: '#fff8e1', padding: 10, margin: 8, borderRadius: 8 }}>
            <Text style={{ color: DRYNKS_RED, fontWeight: '600', textAlign: 'center' }}>
              💣 This chat may expire soon. Don’t miss your chance.
            </Text>
          </View>
        )}

        {isOtherUserTyping && (
          <Text style={{ fontStyle: 'italic', color: '#888', textAlign: 'center', marginVertical: 6 }}>
            Someone is typing...
          </Text>
        )}

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessage}
          contentContainerStyle={{ padding: 12 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd?.({ animated: true })}
        />

        {replyTo && (
          <View style={styles.replyBox}>
            <Text style={styles.replyingText}>Replying to: {replyTo.content}</Text>
            <Text style={styles.cancelReply} onPress={() => setReplyTo(null)}>
              ✖ Cancel
            </Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <TouchableOpacity onPress={() => setShowEmoji((v) => !v)}>
            <Text style={styles.emojiToggle}>😀</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={pickImage}>
            <Text style={styles.emojiToggle}>📷</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Say something clever ✨"
            value={input}
            onChangeText={handleTyping}
          />

          <TouchableOpacity onPress={sendMessage} style={styles.sendBtn}>
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>

        {showEmoji && (
          <EmojiSelector
            onEmojiSelected={(emoji) => setInput((prev) => prev + emoji)}
            showSearchBar={false}
            showTabs
          />
        )}
      </KeyboardAvoidingView>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 6 },
  messageBubble: {
    backgroundColor: DRYNKS_GRAY,
    padding: 12,
    borderRadius: 10,
    maxWidth: '80%',
  },
  messageBubbleOwn: { backgroundColor: '#FFE5E9' },
  messageText: { fontSize: 16 },
  timestamp: { fontSize: 12, color: '#888', marginTop: 4 },
  replyTap: { fontSize: 12, color: DRYNKS_BLUE, marginTop: 4 },
  replyHint: { fontSize: 13, color: '#555', marginBottom: 4, fontStyle: 'italic' },
  replyBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff0f0',
  },
  replyingText: { color: DRYNKS_RED },
  cancelReply: { color: '#999', fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: DRYNKS_WHITE,
    borderTopWidth: 1,
    borderColor: '#eee',
  },
  emojiToggle: { fontSize: 24, marginRight: 8 },
  input: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  sendBtn: {
    backgroundColor: DRYNKS_RED,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  sendText: { color: DRYNKS_WHITE, fontWeight: '600' },
  edit: { color: DRYNKS_BLUE, marginRight: 12 },
  delete: { color: DRYNKS_RED },
  actions: { flexDirection: 'row', marginTop: 4 },
  image: { width: 200, height: 200, borderRadius: 10, marginTop: 8 },
});

export default PrivateChatScreen;
