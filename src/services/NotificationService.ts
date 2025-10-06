// src/services/NotificationService.ts
// Crash-safe notifications + tab-aware deep linking for DrYnks
// - Lazy imports for expo-notifications / expo-device (safe on iOS without plugin)
// - Single source of truth for navigation targets (tabs + screens)
// - All pushes and "bell" rows carry a normalized nav payload: { tab, screen, params }
// - Backwards compatible with legacy { screen, params } consumers

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@config/supabase';

// ─────────────────────────────────────────────────────────────
// 0) ROUTING CONFIG — adjust to your actual Navigator route names
//    These are the defaults inferred from the project structure you shared.
//    If any route name differs in your app, update ONLY this block.
// ─────────────────────────────────────────────────────────────
export const NAV = {
  ROOT_TABS: 'RootTabs', // your <BottomTabNavigator> route name
  TABS: {
    HOME: 'Home',
    DATES: 'Dates',
    MESSAGES: 'Messages',
    PROFILE: 'Profile',
  },
  SCREENS: {
    // Dates cluster
    RECEIVED_INVITES: 'ReceivedInvites',        // "Received Invites page"
    MY_SENT_INVITES: 'MySentInvites',           // src/screens/Dates/MySentInvitesScreen.tsx
    JOIN_REQUESTS: 'JoinRequests',              // src/screens/Dates/JoinRequestsScreen.tsx
    DATE_DETAILS: 'DateDetails',

    // Messages cluster
    MESSAGES_HOME: 'MessagesHome',              // Tab landing / thread list
    GROUP_CHAT: 'GroupChat',                    // Optional deep target (kept for legacy)
  },
} as const;

export type TabKey = typeof NAV.TABS[keyof typeof NAV.TABS];

export type NavTarget = {
  tab?: TabKey;          // Which bottom tab to focus
  screen?: string;       // Nested screen under that tab (optional)
  params?: Record<string, any> | undefined; // Params to pass
};

// Helper to build nested navigate args for React Navigation
// Usage: const [name, params] = buildNavigateArgs(target); navigation.navigate(name, params);
export function buildNavigateArgs(target?: NavTarget): [string, any?] {
  const t = target ?? {};
  if (t.tab) {
    const params = t.screen
      ? { screen: t.tab, params: { screen: t.screen, params: t.params } } // Tabs -> Stack screen
      : { screen: t.tab };
    return [NAV.ROOT_TABS, params];
  }
  if (t.screen) return [t.screen, t.params];
  // Fallback: open Messages tab (safe default)
  return [NAV.ROOT_TABS, { screen: NAV.TABS.MESSAGES }];
}

// ───────────────── Kill-switch ─────────────────
const RAW_FLAG =
  (process as any)?.env?.EXPO_PUBLIC_DISABLE_PUSH ??
  (Constants?.expoConfig as any)?.extra?.EXPO_PUBLIC_DISABLE_PUSH ??
  '0';

export const PUSH_DISABLED =
  String(RAW_FLAG) === '1' ||
  (typeof RAW_FLAG === 'string' && RAW_FLAG.toLowerCase() === 'true');

// ────────────── Detect if the plugin is baked in ──────────────
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
export type NotificationType =
  | 'invite_received'
  | 'invite_revoked'
  | 'invite_accepted'         // accepted BY ME (user is invitee)
  | 'invite_accepted_host'    // accepted OF MY INVITE (user is host)
  | 'join_request_received'
  | 'join_request_accepted'
  | 'generic';

export type DrYnksPushData =
  | { type: 'INVITE_RECEIVED'; date_id: string; invite_id?: string; nav?: NavTarget }
  | { type: 'INVITE_REVOKED';  date_id: string; invite_id?: string; nav?: NavTarget }
  | { type: 'INVITE_ACCEPTED'; date_id: string; invite_id?: string; nav?: NavTarget }        // invitee view
  | { type: 'INVITE_ACCEPTED_HOST'; date_id: string; invite_id?: string; nav?: NavTarget }   // host view
  | { type: 'JOIN_REQUEST';     date_id: string; request_id?: string; nav?: NavTarget }
  | { type: 'JOIN_REQUEST_ACCEPTED'; date_id: string; request_id?: string; nav?: NavTarget }
  | { type: 'CHAT_MESSAGE';     date_id: string; message_id?: string | null; nav?: NavTarget }
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
  const payload = normalizeBellData(data);
  const { error } = await supabase.from('notifications').insert({ user_id: userId, type, data: payload });
  if (error) throw error;
}

// Backward-compatible write shape: always include both modern {nav} and legacy {screen, params}
function normalizeBellData(data: Record<string, any>): Record<string, any> {
  const nav: NavTarget | undefined = data?.nav ?? inferNavFromLegacy(data);
  const legacy = toLegacyShape(nav);
  return { ...data, nav, ...legacy };
}

function inferNavFromLegacy(data: any): NavTarget | undefined {
  if (!data) return undefined;
  if (data.nav) return data.nav;
  if (typeof data.screen === 'string') {
    return { screen: data.screen, params: data.params };
  }
  return undefined;
}

function toLegacyShape(nav?: NavTarget) {
  if (!nav) return {};
  return {
    screen: nav.screen, // legacy consumers may ignore the tab, but still navigate
    params: nav.params,
  };
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
      body: { action: 'notify', userId, title, body, data, bell: bell ? { ...bell, data: normalizeBellData(bell.data) } : undefined },
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
// NOTE: All helpers now write tab-aware nav targets in both push.data.nav and bell.data.nav

export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: DrYnksPushData
) {
  await serverNotify(userId, title, body, data);
}

// Invite received → Received Invites page (Dates tab)
export async function notifyInviteReceived(params: {
  recipientId: string; dateId: string; hostUsername: string; eventTitle: string; eventTimeISO?: string;
}) {
  const { recipientId, dateId, hostUsername, eventTitle, eventTimeISO } = params;
  const nav: NavTarget = { tab: NAV.TABS.DATES, screen: NAV.SCREENS.RECEIVED_INVITES };
  const bellData = { nav, meta: { dateId, eventTitle, eventTimeISO } };
  await serverNotify(
    recipientId,
    `New invite from ${hostUsername}`,
    `You're invited to: ${eventTitle}`,
    { type: 'INVITE_RECEIVED', date_id: dateId, nav },
    { type: 'invite_received', data: bellData }
  );
}

// Invite rescinded → My Sent Invites (Dates tab)
export async function notifyInviteRevoked(params: {
  recipientId: string; dateId: string; eventTitle: string;
}) {
  const { recipientId, dateId, eventTitle } = params;
  const nav: NavTarget = { tab: NAV.TABS.DATES, screen: NAV.SCREENS.MY_SENT_INVITES };
  const bellData = { nav, meta: { dateId, eventTitle } };
  await serverNotify(
    recipientId,
    'Invite rescinded',
    `The host rescinded: ${eventTitle}`,
    { type: 'INVITE_REVOKED', date_id: dateId, nav },
    { type: 'invite_revoked', data: bellData }
  );
}

// I (invitee) was accepted → could go to Date Details or ReceivedInvites; keeping intent: celebrate acceptance.
// If you prefer opening a different screen, adjust NAV.SCREENS.* or swap nav below.
export async function notifyInviteAccepted(params: {
  acceptedUserId: string; dateId: string; eventTitle: string;
}) {
  const { acceptedUserId, dateId, eventTitle } = params;
  const nav: NavTarget = { tab: NAV.TABS.DATES, screen: NAV.SCREENS.DATE_DETAILS, params: { dateId } };
  const bellData = { nav, meta: { eventTitle } };
  await serverNotify(
    acceptedUserId,
    'You were accepted! 🎉',
    `You're in for: ${eventTitle}`,
    { type: 'INVITE_ACCEPTED', date_id: dateId, nav },
    { type: 'invite_accepted', data: bellData }
  );
}

// HOST view: someone accepted an invite I sent → Manage/My Sent Invites (Dates tab)
export async function notifyInviteAcceptedHost(params: {
  hostId: string; dateId: string; accepterUsername: string; eventTitle: string;
}) {
  const { hostId, dateId, accepterUsername, eventTitle } = params;
  const nav: NavTarget = { tab: NAV.TABS.DATES, screen: NAV.SCREENS.MY_SENT_INVITES };
  const bellData = { nav, meta: { dateId, eventTitle, accepterUsername } };
  await serverNotify(
    hostId,
    'Invite accepted',
    `${accepterUsername} accepted your invite for: ${eventTitle}`,
    { type: 'INVITE_ACCEPTED_HOST', date_id: dateId, nav },
    { type: 'invite_accepted', data: bellData } // uses same bell type for badge filtering
  );
}

// Join request arrived → Join Requests screen (Dates tab)
export async function notifyJoinRequestReceived(params: {
  hostId: string; dateId: string; requesterUsername: string; eventTitle: string;
}) {
  const { hostId, dateId, requesterUsername, eventTitle } = params;
  const nav: NavTarget = { tab: NAV.TABS.DATES, screen: NAV.SCREENS.JOIN_REQUESTS };
  const bellData = { nav, meta: { dateId, eventTitle, requesterUsername } };
  await serverNotify(
    hostId,
    'New join request',
    `${requesterUsername} wants to join: ${eventTitle}`,
    { type: 'JOIN_REQUEST', date_id: dateId, nav },
    { type: 'join_request_received', data: bellData }
  );
}

// Join request accepted (notify requester) → Join Requests screen (Dates tab) or Date Details
export async function notifyJoinRequestAccepted(params: {
  requesterId: string; dateId: string; eventTitle: string;
}) {
  const { requesterId, dateId, eventTitle } = params;
  const nav: NavTarget = { tab: NAV.TABS.DATES, screen: NAV.SCREENS.JOIN_REQUESTS };
  const bellData = { nav, meta: { dateId, eventTitle } };
  await serverNotify(
    requesterId,
    'Request accepted',
    `You're in for: ${eventTitle}`,
    { type: 'JOIN_REQUEST_ACCEPTED', date_id: dateId, nav },
    { type: 'join_request_accepted', data: bellData }
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

/* ───────────────────────────────────────────────────────────
   CHAT MESSAGE PUSH — server-first (Edge Function), client fallback
   NOW routes to the Messages tab (tab-safe), not a detached screen.
────────────────────────────────────────────────────────── */

async function getChatMemberIds(dateId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('date_requests')
      .select('creator, accepted_users')
      .eq('id', dateId)
      .maybeSingle();
    if (error || !data) return [];
    const out = new Set<string>();
    if ((data as any)?.creator) out.add((data as any).creator as string);
    const arr = Array.isArray((data as any)?.accepted_users)
      ? ((data as any).accepted_users as string[])
      : [];
    arr.forEach((id) => id && out.add(id));
    return Array.from(out);
  } catch {
    return [];
  }
}

/**
 * Fire a push for a new chat message.
 * Data payload points at the Messages tab (safe) and includes dateId for context.
 */
export async function sendPushForMessage(input: {
  dateId: string;
  senderId: string;
  text: string;
  messageId?: string;
}) {
  if (PUSH_DISABLED) return;

  // 1) Preferred path — server fan-out (Edge Function decides recipients)
  try {
    const { error } = await supabase.functions.invoke('notify_chat_members', {
      body: {
        dateId: input.dateId,
        senderId: input.senderId,
        messageId: input.messageId ?? null,
        text: input.text,
      },
    });
    if (!error) return;
  } catch (e) {
    if (__DEV__) console.log('[ChatPush] notify_chat_members missing/unavailable:', (e as any)?.message || e);
  }

  // 2) Fallback — client-side fan-out (best-effort)
  try {
    const members = await getChatMemberIds(input.dateId);
    const recipients = members.filter((uid) => uid && uid !== input.senderId);
    if (!recipients.length) return;

    const nav: NavTarget = { tab: NAV.TABS.MESSAGES, screen: NAV.SCREENS.MESSAGES_HOME, params: { dateId: input.dateId } };
    const payload: DrYnksPushData = {
      type: 'CHAT_MESSAGE',
      date_id: input.dateId,
      message_id: input.messageId ?? null,
      nav,
    };

    // Gather tokens
    const tokenList: string[] = [];
    for (const uid of recipients) {
      const toks = await fetchUserDeviceTokens(uid);
      toks.forEach((t) => tokenList.push(t));
    }
    if (!tokenList.length) {
      // At least ensure bell shows a badge and carries nav
      await Promise.all(
        recipients.map((uid) =>
          insertBellNotification(uid, 'generic', {
            nav,
            meta: { preview: input.text, dateId: input.dateId },
          })
        )
      );
      return;
    }

    // Send Expo pushes
    const msgs = tokenList.map((to) => ({
      to,
      title: 'New message',
      body: input.text,
      data: payload,
    }));
    const { badTokens } = await sendExpoPush(msgs);
    if (badTokens.length) await pruneInvalidTokens(badTokens);

    // Mirror bell notifications (with tab-aware nav)
    await Promise.all(
      recipients.map((uid) =>
        insertBellNotification(uid, 'generic', {
          nav,
          meta: { preview: input.text, dateId: input.dateId },
        })
      )
    );
  } catch (err) {
    console.warn('[ChatPush] fallback fan-out failed:', (err as any)?.message || err);
  }
}

// ────────────────────────── NAV RESOLVERS ──────────────────────────
// Use these in your UI handlers to open the correct tab+screen

export function getNavFromPushData(data?: DrYnksPushData | Record<string, any> | null): NavTarget {
  if (!data) return { tab: NAV.TABS.MESSAGES };
  // Prefer explicit nav
  if ((data as any)?.nav) return (data as any).nav as NavTarget;

  // Legacy keys
  if (typeof (data as any)?.route === 'string' && (data as any).route === NAV.SCREENS.GROUP_CHAT) {
    return { tab: NAV.TABS.MESSAGES, screen: NAV.SCREENS.MESSAGES_HOME, params: { dateId: (data as any)?.dateId } };
  }
  if (typeof (data as any)?.screen === 'string') {
    return { screen: (data as any).screen, params: (data as any).params };
  }
  return { tab: NAV.TABS.MESSAGES };
}

export function getNavFromBellData(bellData?: any): NavTarget {
  if (!bellData) return { tab: NAV.TABS.MESSAGES };
  if (bellData.nav) return bellData.nav as NavTarget;
  if (typeof bellData.screen === 'string') return { screen: bellData.screen, params: bellData.params };
  return { tab: NAV.TABS.MESSAGES };
}
