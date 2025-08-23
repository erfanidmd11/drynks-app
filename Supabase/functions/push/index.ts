// supabase/functions/push/index.ts
// Edge Function to send Expo push notifications and (optionally) insert a bell notification.
// Matches NotificationService.serverNotify() contract:
//
// Request JSON:
// {
//   "action": "notify",
//   "userId": "uuid",
//   "title": "string",
//   "body": "string",
//   "data": { ... },                      // optional (DrYnksPushData)
//   "bell": { "type": "invite_received", "data": {...} } // optional
// }

import { createClient } from 'npm:@supabase/supabase-js@2';

type BellPayload = { type: string; data: Record<string, any> };
type NotifyRequest = {
  action: 'notify';
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  bell?: BellPayload | null;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, serviceKey);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_BATCH = 100;

// Optional: if you’ve created a service role for Realtime prunes, etc.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isExpoToken(t?: string | null): t is string {
  return !!t && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function fetchAllTokens(userId: string): Promise<string[]> {
  const tokens = new Set<string>();

  // Legacy profile mirror
  const { data: prof } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('id', userId)
    .maybeSingle();
  if (isExpoToken(prof?.push_token)) tokens.add(prof!.push_token);

  // device_tokens
  const { data: devs, error } = await supabase
    .from('device_tokens')
    .select('token, revoked_at')
    .eq('user_id', userId);
  if (!error) {
    devs?.forEach((r: any) => isExpoToken(r?.token) && !r?.revoked_at && tokens.add(r.token));
  }

  return Array.from(tokens);
}

async function pruneInvalidTokens(tokens: string[]) {
  if (!tokens.length) return;
  const now = new Date().toISOString();

  // Soft-revoke
  const { error: updErr } = await supabase
    .from('device_tokens')
    .update({ revoked_at: now })
    .in('token', tokens);

  // If column doesn't exist, hard delete fallback
  if (updErr?.message?.includes('column "revoked_at" does not exist')) {
    await supabase.from('device_tokens').delete().in('token', tokens);
  }
}

async function insertBellNotification(userId: string, bell: BellPayload) {
  await supabase
    .from('notifications')
    .insert({ user_id: userId, type: bell.type, data: bell.data })
    .throwOnError();
}

async function sendExpoPush(tokens: string[], title: string, body: string, data?: any) {
  if (!tokens.length) return { badTokens: [] as string[] };

  const messages = tokens.map((to) => ({ to, title, body, data }));
  const batches = chunk(messages, MAX_BATCH);

  const badTokens: string[] = [];
  const auth = Deno.env.get('EXPO_ACCESS_TOKEN');

  for (const batch of batches) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(batch),
    });

    let jsonResp: any = null;
    try {
      jsonResp = await res.json();
    } catch {
      // ignore body parse errors
    }

    if (!res.ok) {
      console.warn('[push] Expo HTTP error:', res.status, jsonResp);
      continue;
    }

    const tickets = jsonResp?.data as Array<{ status: string; message?: string; details?: any }>;
    if (Array.isArray(tickets)) {
      tickets.forEach((t, idx) => {
        if (t?.status === 'error') {
          const token = batch[idx]?.to;
          const code = t?.details?.error;
          if (code === 'DeviceNotRegistered' || code === 'InvalidCredentials') {
            if (token) badTokens.push(token);
          }
          console.warn('[push] Expo ticket error:', { token, code, message: t?.message });
        }
      });
    }
  }

  return { badTokens };
}

async function handleNotify(reqBody: NotifyRequest) {
  const { userId, title, body, data, bell } = reqBody;

  // Collect tokens
  const tokens = await fetchAllTokens(userId);

  // If no tokens, still insert bell (if requested), then return 204
  if (!tokens.length) {
    if (bell) await insertBellNotification(userId, bell);
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Send pushes
  const { badTokens } = await sendExpoPush(tokens, title, body, data);

  // Prune invalid tokens
  if (badTokens?.length) {
    await pruneInvalidTokens(badTokens);
  }

  // Bell (optional)
  if (bell) {
    await insertBellNotification(userId, bell);
  }

  return json({ ok: true, sent: tokens.length, pruned: badTokens?.length ?? 0 });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    // Primary action: "notify"
    if (payload?.action === 'notify') {
      // Basic validation
      if (!payload.userId || !payload.title || !payload.body) {
        return json({ error: 'Missing required fields: userId, title, body' }, 400);
      }
      return await handleNotify(payload as NotifyRequest);
    }

    // Backward-compat: your older code path
    // Expect payload.record with { id, title, creator } for a single-target push
    if (payload?.record?.id && payload?.record?.creator) {
      const { data } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', payload.record.creator)
        .maybeSingle();

      const pushToken = data?.push_token;
      if (!isExpoToken(pushToken)) {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const msg = {
        to: pushToken,
        title: 'New nearby date',
        body: payload.record.title,
        data: { dateId: payload.record.id },
      };

      const auth = Deno.env.get('EXPO_ACCESS_TOKEN');
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify([msg]),
      });
      const jsonResp = await res.json().catch(() => ({}));
      return json(jsonResp, res.ok ? 200 : 500);
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('[push] Unhandled error:', e);
    return json({ error: 'Internal error' }, 500);
  }
});
