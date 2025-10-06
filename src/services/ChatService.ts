// src/services/ChatService.ts
import { createClient } from '@supabase/supabase-js';
import { Alert } from 'react-native';

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!);

export type RoomId = string;

async function getOrCreateRoomIdForDate(dateId: string): Promise<RoomId> {
  // Prefer DB helper if you expose it as RPC
  const { data, error } = await supabase.rpc('ensure_date_room', { p_date_id: dateId });
  if (error) throw error;
  return data as RoomId;
}

export async function openRoomForDate(dateId: string, navigateToChat: (roomId: string) => void) {
  try {
    const roomId = await getOrCreateRoomIdForDate(dateId);
    navigateToChat(roomId);
  } catch (e: any) {
    console.error('openRoomForDate error', e);
    Alert.alert('Chat', e?.message ?? 'Unable to open chat.');
  }
}

// Not strictly needed client-side (triggers handle membership), but useful if you want optimistic UX:
export async function addMember(dateId: string, userId: string) {
  const { error } = await supabase.rpc('chat_add_member', { p_date_id: dateId, p_user_id: userId });
  if (error) throw error;
}
export async function removeMember(dateId: string, userId: string) {
  const { error } = await supabase.rpc('chat_remove_member', { p_date_id: dateId, p_user_id: userId });
  if (error) throw error;
}
