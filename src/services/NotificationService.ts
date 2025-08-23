// src/services/NotificationService.ts
// Crash-safe (iOS18/RN0.74) notifications service:
// - No top-level imports of expo-notifications / expo-device (lazy-loaded).
// - Never imports expo-notifications on iOS if the plugin is not present.
// - Honors EXPO_PUBLIC_DISABLE_PUSH kill switch.
// - Idempotent init; safe on cold start; no early listeners.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@config/supabase';

// ───────────────── Kill-switch ─────────────────
const RAW_FLAG =
  (process as any)?.env?.EXPO_PUBLIC_DISABLE_PUSH ??
  (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_DISABLE_PUSH ??
  '0';

export const PUSH_DISABLED =
  String(RAW_FLAG) === '1' ||
  (typeof RAW_FLAG === 'string' && RAW_FLAG.toLowerCase() === 'true');

// ────────────── Detect if the plugin is baked in ──────────────
// If 'expo-notifications' is not listed in app.config plugins, don't import it.
function notificationsPluginPresent(): boolean {
  const plugins = (Constants?.expoConfig as any)?.plugins ?? [];
  if (!Array.isArray(plugins)) return false;
  return plugins.some((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    return name === 'expo-notifications';
  });
}

const NOTIFS_PLUGIN_PRESENT = notificationsPluginPresent();

// ───────────────── Lazy module loaders ─────────────────
type NotificationsNS = typeof import('expo-notifications');
type DeviceNS = typeof import('expo-device');

let Notifs: NotificationsNS | null = null;
let DeviceMod: DeviceNS | null = null;

async function getNotifications(): Promise<NotificationsNS | null> {
  try {
    // Hard gate: if push is disabled, or we're on iOS without the plugin, never import.
    if (PUSH_DISABLED) return null;
    if (Platform.OS === 'ios' && !NOTIFS_PLUGIN_PRESENT) return null;
    if (!Notifs) Notifs = await import('expo-notifications');
    return Notifs;
  } catch {
    return null;
  }
}

async function getDevice(): Promise<DeviceNS | null> {
  try {
    if (!DeviceMod) DeviceMod = await import('expo-device');
    return DeviceMod;
  } catch {
    return null;
  }
}

// ───────────────── Types ─────────────────
export type Handler = NonNullable<NotificationsNS['setNotificationHandler']>;
export type NotificationType =
  | 'invite_received'
  | 'invite_revoked'
  | 'invite_accepted'
  | 'join_request_received'
  | 'join_request_accepted'
  | 'generic';

export type DrYnksPushData =
  | { type: 'INVITE_RECEIVED'; date_id: string; invite_id?: string }
  | { type: 'INVITE_REVOKED';  date_id: string; invite_id?: string }
  | { type: 'INVITE_ACCEPTED'; date_id: string; invite_id?: string }
  | { type: 'JOIN_REQUEST';    date_id: string; request_id?: string }
  | { [k: string]: any };

type RegisterResult = { token?: string; error?: string };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_EXPO_BATCH = 100;

// ───────────────── Utils ─────────────────
function isLikelyExpoToken(t?: string | null) {
  return !!t && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'));
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function nowISO() { return new Date().toISOString(); }

function getProjectId(): string | undefined {
  // Prefer EAS projectId
  const fromExtra = (Constants?.expoConfig as any)?.extra?.eas?.projectId;
  const fromEas = (Constants as any)?.easConfig?.projectId;
  const fromExpoCfg = (Constants?.expoConfig as any)?.projectId; // newer SDKs
  return fromExtra || fromEas || fromExpoCfg || undefined;
}

// ─────────────── Client-side registration ─────────────
export const registerForPushNotificationsAsync = async (): Promise<RegisterResult> => {
  try {
    if (PUSH_DISABLED) return { error: 'disabled' };

    const Notifs = await getNotifications();
    const Device = await getDevice();
    if (!Notifs || !Device) return { error: 'unavailable' };

    if (!Device.isDevice) {
      // Physical device required for push
      return { error: 'not_a_device' };
    }

    const { status: existingStatus } = await Notifs.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifs.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return { error: 'permission_denied' };

    const projectId = getProjectId();
    const tokenResp = await Notifs.getExpoPushTokenAsync(
      projectId ? ({ projectId } as any) : (undefined as any)
    );
    const token = (tokenResp as any)?.data ?? (tokenResp as any)?.expoPushToken ?? null;
    if (!token) return { error: 'no_token' };

    if (Platform.OS === 'android') {
      await Notifs.setNotificationChannelAsync('default', {
        name: 'default',
        importance: (Notifs as any).AndroidImportance?.MAX ?? 5,
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: (Notifs as any).AndroidNotificationVisibility?.PUBLIC ?? 1,
        enableLights: true,
        enableVibrate: true,
        sound: true,
        bypassDnd: false,
        showBadge: true,
      } as any);
    }

    const { data: sess } = await supabase.auth.getSession();
    const userId = sess?.session?.user?.id;
    if (userId) {
      await supabase.from('profiles').update({ push_token: token }).eq('id', userId);
      await supabase
        .from('device_tokens')
        .upsert(
          { user_id: userId, token, platform: Platform.OS, updated_at: nowISO() },
          { onConflict: 'user_id,token' }
        );
    }

    return { token };
  } catch (err: any) {
    console.error('[Push Registration Error]', err);
    return { error: String(err?.message || err) };
  }
};

// ───────────────────── Token management ─────────────────────
async function fetchUserDeviceTokens(userId: string): Promise<string[]> {
  const tokens = new Set<string>();

  const { data: prof, error: profErr } = await supabase
    .from('profiles').select('push_token').eq('id', userId).single();
  if (profErr && profErr.code !== 'PGRST116') console.warn('[Push] profiles fetch error:', profErr.message);
  if (isLikelyExpoToken(prof?.push_token)) tokens.add(prof!.push_token as string);

  const { data: devs, error: devErr } = await supabase
    .from('device_tokens').select('token, revoked_at').eq('user_id', userId);
  if (devErr) {
    console.warn('[Push] device_tokens fetch error:', devErr.message);
  } else {
    devs?.forEach((r: any) => isLikelyExpoToken(r?.token) && !r?.revoked_at && tokens.add(r.token));
  }

  return Array.from(tokens);
}

async function pruneInvalidTokens(tokens: string[]) {
  if (!tokens.length) return;
  const { error: updErr } = await supabase
    .from('device_tokens')
    .update({ revoked_at: nowISO() })
    .in('token', tokens);

  if (updErr?.message?.includes('column "revoked_at" does not exist')) {
    const { error: delErr } = await supabase.from('device_tokens').delete().in('token', tokens);
    if (delErr) console.warn('[Push] pruneInvalidTokens delete error:', delErr.message);
    return;
  }
  if (updErr) console.warn('[Push] pruneInvalidTokens update error:', updErr.message);
}

// ───────────────────── Push transport ──────────────────────
async function sendExpoPush(
  messages: Array<{ to: string; title: string; body: string; data?: any }>
) {
  if (!messages.length || PUSH_DISABLED) return { badTokens: [] as string[] };

  const badTokens: string[] = [];
  const batches = chunk(messages, MAX_EXPO_BATCH);

  for (const batch of batches) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });

    let json: any = null;
    try { json = await res.json(); } catch {}

    if (!res.ok) {
      console.warn('[ExpoPush] HTTP error', res.status, json);
      continue;
    }

    const tickets = (json?.data as Array<{ status: string; message?: string; details?: any }>) || [];
    tickets.forEach((t, idx) => {
      if (t?.status === 'error') {
        const token = batch[idx]?.to;
        const code = t?.details?.error;
        if (code === 'DeviceNotRegistered' || code === 'InvalidCredentials') {
          if (token) badTokens.push(token);
        }
        console.warn('[ExpoPush] ticket error', { token, code, message: t?.message });
      }
    });
  }

  return { badTokens };
}

// ──────────────── Bell notifications (DB) ──────────────────
export async function insertBellNotification(
  userId: string,
  type: NotificationType,
  data: Record<string, any>
) {
  const { error } = await supabase.from('notifications').insert({ user_id: userId, type, data });
  if (error) throw error;
}

export async function markNotificationsReadFor(userId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: nowISO() })
    .is('read_at', null)
    .eq('user_id', userId);
  if (error) console.warn('[Push] markNotificationsReadFor error:', error.message);
}

export async function markNotificationsReadForTypes(
  userId: string,
  types: NotificationType[]
) {
  if (!types?.length) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: nowISO() })
    .eq('user_id', userId)
    .in('type', types)
    .is('read_at', null);
  if (error) console.warn('[Push] markNotificationsReadForTypes error:', error.message);
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null)
    .eq('user_id', userId);
  if (error) {
    console.warn('[Push] getUnreadNotificationCount error:', error.message);
    return 0;
  }
  return count ?? 0;
}

export function watchUnreadCount(
  userId: string,
  onChange: (count: number) => void
): () => void {
  if (PUSH_DISABLED) {
    Promise.resolve(0).then(onChange);
    return () => {};
  }
  getUnreadNotificationCount(userId).then(onChange).catch(() => {});
  const channel = supabase
    .channel(`notifications_count_${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      async () => {
        const n = await getUnreadNotificationCount(userId);
        onChange(n);
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ───────────── Server-side push (Edge Function) ─────────────
async function serverNotify(
  userId: string,
  title: string,
  body: string,
  data?: DrYnksPushData,
  bell?: { type: NotificationType; data: any }
) {
  if (PUSH_DISABLED) return true;
  try {
    const { error } = await supabase.functions.invoke('push', {
      body: { action: 'notify', userId, title, body, data, bell },
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[Push] Edge Function invoke failed, falling back to client send.', e);
    try {
      const tokens = await fetchUserDeviceTokens(userId);
      if (!tokens.length) {
        if (bell) await insertBellNotification(userId, bell.type, bell.data);
        return true;
      }
      const msgs = tokens.map((to) => ({ to, title, body, data }));
      const { badTokens } = await sendExpoPush(msgs);
      if (badTokens.length) await pruneInvalidTokens(badTokens);
      if (bell) await insertBellNotification(userId, bell.type, bell.data);
      return true;
    } catch (inner) {
      console.error('[Push] Client fallback failed:', inner);
      return false;
    }
  }
}

// ─────────────────── High-level helpers ────────────────────
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: DrYnksPushData
) {
  await serverNotify(userId, title, body, data);
}

// Convenience wrappers you already use
export async function notifyInviteReceived(params: {
  recipientId: string; dateId: string; hostUsername: string; eventTitle: string; eventTimeISO?: string;
}) {
  const { recipientId, dateId, hostUsername, eventTitle, eventTimeISO } = params;
  const bellData = { screen: 'DateDetails', params: { dateId }, meta: { eventTitle, eventTimeISO } };
  await serverNotify(
    recipientId,
    `New invite from ${hostUsername}`,
    `You're invited to: ${eventTitle}`,
    { type: 'INVITE_RECEIVED', date_id: dateId },
    { type: 'invite_received', data: bellData }
  );
}

export async function notifyInviteRevoked(params: {
  recipientId: string; dateId: string; eventTitle: string;
}) {
  const { recipientId, dateId, eventTitle } = params;
  const bellData = { screen: 'MyInvites', params: undefined, meta: { dateId, eventTitle } };
  await serverNotify(
    recipientId,
    'Invite rescinded',
    `The host rescinded: ${eventTitle}`,
    { type: 'INVITE_REVOKED', date_id: dateId },
    { type: 'invite_revoked', data: bellData }
  );
}

export async function notifyInviteAccepted(params: {
  acceptedUserId: string; dateId: string; eventTitle: string;
}) {
  const { acceptedUserId, dateId, eventTitle } = params;
  const bellData = { screen: 'DateDetails', params: { dateId }, meta: { eventTitle } };
  await serverNotify(
    acceptedUserId,
    'You were accepted! 🎉',
    `You're in for: ${eventTitle}`,
    { type: 'INVITE_ACCEPTED', date_id: dateId },
    { type: 'invite_accepted', data: bellData }
  );
}

export async function notifyJoinRequestReceived(params: {
  hostId: string; dateId: string; requesterUsername: string; eventTitle: string;
}) {
  const { hostId, dateId, requesterUsername, eventTitle } = params;
  const bellData = { screen: 'JoinRequests', params: undefined, meta: { dateId, eventTitle } };
  await serverNotify(
    hostId,
    'New join request',
    `${requesterUsername} wants to join: ${eventTitle}`,
    { type: 'JOIN_REQUEST', date_id: dateId },
    { type: 'join_request_received', data: bellData }
  );
}

// ───────────── Foreground presentation config ─────────────
export async function configureForegroundPresentation() {
  if (PUSH_DISABLED) return;
  const Notifs = await getNotifications();
  if (!Notifs?.setNotificationHandler) return;
  try {
    await Notifs.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (e) {
    console.warn('[Push] setNotificationHandler failed:', (e as Error)?.message);
  }
}

// ───────────── Convenience: ensure registration ────────────
let _initialized = false;
export async function initNotificationsOnce(): Promise<void> {
  if (_initialized || PUSH_DISABLED) return;
  _initialized = true;

  // On iOS without plugin, do nothing.
  if (Platform.OS === 'ios' && !NOTIFS_PLUGIN_PRESENT) return;

  try {
    await configureForegroundPresentation();
    const result = await registerForPushNotificationsAsync();
    if (result.error && result.error !== 'permission_denied' && result.error !== 'disabled') {
      console.warn('[Push] Registration warning:', result.error);
    }
  } catch (e) {
    console.warn('[Push] initNotificationsOnce error:', (e as Error).message);
  }
}
