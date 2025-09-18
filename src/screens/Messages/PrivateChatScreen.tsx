// PrivateChatScreen.tsx – Final Production Ready with Typing Indicator + All Features
import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, Image
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { supabase } from '@config/supabase';
import AppShell from '@components/AppShell';
import EmojiSelector from 'react-native-emoji-selector';
import Animated, { FadeInUp } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { decode as atob } from 'base-64';
import Avatar from '../../ui/Avatar'; // ✅ NEW

const DRYNKS_RED = '#E34E5C';
const DRYNKS_BLUE = '#232F39';
const DRYNKS_GRAY = '#E1EBF2';
const DRYNKS_WHITE = '#FFFFFF';

const DAILY_LIMIT = 3;
const CHAT_BUCKET = 'chat-media'; // keep your existing bucket name

const PrivateChatScreen = () => {
  const [mediaUri, setMediaUri] = useState('');
  const route = useRoute<any>();
  const { otherUserId } = route.params ?? {};
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [chatAllowed, setChatAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [editMessage, setEditMessage] = useState<any>(null);
  const [expiresSoon, setExpiresSoon] = useState(false);
  const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
  const flatListRef = useRef<FlatList<any>>(null);
  let typingTimeout: any = useRef(null);

  // Cache current user id once for render-time comparisons
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setCurrentUserId(data?.user?.id ?? null);
    })();
  }, []);

  // ✅ NEW: load other user's profile so we can show their avatar
  const [otherProfile, setOtherProfile] = useState<{ id: string; screenname: string | null; profile_photo: string | null } | null>(null);
  useEffect(() => {
    if (!otherUserId) return;
    supabase
      .from('profiles')
      .select('id, screenname, profile_photo')
      .eq('id', otherUserId)
      .single()
      .then(({ data }) => setOtherProfile(data as any))
      .catch(() => {});
  }, [otherUserId]);

  useEffect(() => {
    const setup = async () => {
      await checkChatLimit();
      await insertJoinSystemMessage();
      await fetchMessages();
      const channel = supabase
        .channel('private-chat')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
          const { new: msg } = payload;
          if (msg.user_id === otherUserId || msg.recipient_id === otherUserId) {
            setMessages(prev => [...prev, msg]);
            flatListRef.current?.scrollToEnd?.({ animated: true });
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_typing' }, payload => {
          const { user_id, typing } = payload.new;
          if (user_id === otherUserId) setIsOtherUserTyping(typing);
        })
        .subscribe();
      return () => supabase.removeChannel(channel);
    };
    setup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTyping = async (text: string) => {
    setInput(text);
    const { data } = await supabase.auth.getUser();
    const { user } = data || {};
    clearTimeout(typingTimeout.current);
    await supabase.from('chat_typing').upsert({ user_id: user?.id, typing: true });
    typingTimeout.current = setTimeout(async () => {
      await supabase.from('chat_typing').upsert({ user_id: user?.id, typing: false });
    }, 2000);
  };

  const checkChatLimit = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    const { count } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if ((count ?? 0) >= DAILY_LIMIT) setChatAllowed(false);
  };

  const insertJoinSystemMessage = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const screenname = userData?.user?.user_metadata?.screenname || 'Someone';
    const exists = messages.some(m => m.user_id === userData?.user?.id && m.type === 'system');
    if (!exists) {
      await supabase.from('chat_messages').insert({
        user_id: userData?.user?.id,
        recipient_id: otherUserId,
        content: `🥂 ${screenname} just joined the chat. Let the pregame begin!`,
        type: 'system',
      });
    }
  };

  const fetchMessages = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const me = sessionData?.session?.user?.id;
    await supabase.from('chat_seen').upsert({
      user_id: me,
      date_id: null,
      recipient_id: otherUserId,
      last_seen: new Date().toISOString(),
    });
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .or(`user_id.eq.${otherUserId},recipient_id.eq.${otherUserId}`)
      .order('created_at');
    if (!error && data) {
      setMessages(data);
      const event = data.find(m => m.date_id)?.event_date;
      if (event && new Date(event) < new Date(Date.now() + 24 * 60 * 60 * 1000)) {
        setExpiresSoon(true);
      }
    }
    setLoading(false);
  };

  // ── FIX 1: Updated to new ImagePicker API + permission check ────────────────────
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'We need access to your photos to continue.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaType.Images, // ✅ new API
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length) {
      setMediaUri(result.assets[0].uri);
    }
  };

  // RN-safe base64 -> Uint8Array (prevents zero-byte uploads)
  function base64ToUint8Array(b64: string): Uint8Array {
    const bin =
      typeof (globalThis as any).atob === 'function'
        ? (globalThis as any).atob(b64)
        : atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Normalize to JPEG and upload bytes to Supabase Storage; returns public URL
  const uploadMediaIfAny = async (): Promise<string> => {
    if (!mediaUri) return '';

    // Normalize/resize to JPEG to avoid HEIC/WebP/ph:// problems
    const manipulated = await ImageManipulator.manipulateAsync(
      mediaUri,
      [{ resize: { width: 1280 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );

    const fileName = `${Date.now()}_${(manipulated.uri.split('/').pop() || 'image')}.jpg`;

    // Read as base64 → bytes
    const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64);

    const { data, error } = await supabase.storage
      .from(CHAT_BUCKET)
      .upload(fileName, bytes, {
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
    const { user } = userData || {};

    // ── FIX 2: Robust upload path ────────────────────────────────────────────────
    const uploadedUrl = await uploadMediaIfAny();

    if (editMessage) {
      await supabase
        .from('chat_messages')
        .update({ content: input.trim(), media_url: uploadedUrl || null })
        .eq('id', editMessage.id);
      setEditMessage(null);
      fetchMessages();
      return;
    }

    await supabase.from('chat_messages').insert({
      content: input.trim(),
      user_id: user?.id,
      recipient_id: otherUserId,
      reply_to: replyTo?.id || null,
      media_url: uploadedUrl || null,
    });

    setInput('');
    setMediaUri('');
    setReplyTo(null);

    await supabase.from('notifications').insert({
      user_id: otherUserId,
      message: `${user?.user_metadata?.screenname || 'Someone'} sent you a message`,
      screen: 'PrivateChatScreen',
      params: { otherUserId },
      read: false,
    });
  };

  const scrollToMessage = (id: string | number) => {
    const index = messages.findIndex(m => m.id === id);
    if (index !== -1) flatListRef.current?.scrollToIndex?.({ index, animated: true });
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isOwn = !!currentUserId && item.user_id === currentUserId;
    return (
      <View style={[styles.msgRow, isOwn ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        {!isOwn && <Avatar url={otherProfile?.profile_photo || undefined} size={26} style={{ marginRight: 6 }} />}
        <Animated.View entering={FadeInUp} style={[styles.messageBubble, isOwn && styles.messageBubbleOwn]}>
          {item.reply_to && (
            <Text style={styles.replyHint}>
              ↩️ Replying to: {messages.find(m => m.id === item.reply_to)?.content}
              <Text onPress={() => scrollToMessage(item.reply_to)} style={{ color: DRYNKS_BLUE, marginLeft: 6 }}> [Jump]</Text>
            </Text>
          )}
          <Text style={styles.messageText}>{item.content}</Text>
          {item.media_url && <Image source={{ uri: item.media_url }} style={styles.image} />}
          <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleTimeString()}</Text>
          <Text style={styles.replyTap} onPress={() => setReplyTo(item)}>💬 Reply</Text>
          {isOwn && (
            <View style={styles.actions}>
              <Text
                style={styles.edit}
                onPress={() => {
                  setInput(item.content);
                  setEditMessage(item);
                }}
              >
                ✏️ Edit
              </Text>
              <Text
                style={styles.delete}
                onPress={async () => {
                  Alert.alert('Delete Message', 'Are you sure?', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        if (item.media_url) {
                          const filename = item.media_url.split('/').pop();
                          if (filename) await supabase.storage.from(CHAT_BUCKET).remove([filename]);
                        }
                        await supabase.from('chat_messages').delete().eq('id', item.id);
                        fetchMessages();
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {expiresSoon && (
          <View style={{ backgroundColor: '#fff8e1', padding: 10, margin: 8, borderRadius: 8 }}>
            <Text style={{ color: DRYNKS_RED, fontWeight: '600', textAlign: 'center' }}>
              💣 This chat will self-destruct in 24 hours. Use it... or lose it.
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
          keyExtractor={item => item.id.toString()}
          renderItem={renderMessage}
          contentContainerStyle={{ padding: 12 }}
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
            placeholder="Say something clever ✨"
            value={input}
            onChangeText={handleTyping}
          />
          <TouchableOpacity onPress={sendMessage} style={styles.sendBtn}>
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
        {showEmoji && (
          <EmojiSelector onEmojiSelected={emoji => setInput(prev => prev + emoji)} showSearchBar={false} showTabs={true} />
        )}
      </KeyboardAvoidingView>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 6 }, // ✅ NEW
  messageBubble: {
    backgroundColor: DRYNKS_GRAY,
    padding: 12,
    borderRadius: 10,
    maxWidth: '80%',
  },
  messageBubbleOwn: { backgroundColor: '#FFE5E9' }, // subtle tint for own messages
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
