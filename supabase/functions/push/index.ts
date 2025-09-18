// supabase/functions/push/index.ts
// Edge Function to send Expo push notifications and (optionally) insert a bell notification.
// Matches NotificationService.serverNotify() contract.
//
// POST JSON:
// {
//   "action": "notify",
//   "userId": "uuid",
//   "title": "string",
//   "body": "string",
//   "data": { ... },                                       // optional (DrYnks push payload)
//   "bell": { "type": "invite_received", "data": {...} }  // optional (for in-app bell)
// }
//
// Secrets required (set via `supabase secrets set`):
//  - SERVICE_ROLE_KEY   (REQUIRED)  ← CLI allows this name
//  - EXPO_ACCESS_TOKEN  (OPTIONAL)  ← if you use an Expo access token
//
// Note: SUPABASE_URL is automatically injected into Edge Functions.

import { createClient } from 'npm:@supabase/supabase-js@2';

type Json = Record<string, any>;
type BellPayload = { type: string; data: Json };
type NotifyRequest = {
  action: 'notify';
  userId: string;
  title: string;
  body: string;
  data?: Json;
  bell?: BellPayload | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey =
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); // fallback if previously set

if (!supabaseUrl || !serviceKey) {
  console.error('[push] Missing SUPABASE_URL or SERVICE_ROLE_KEY.');
  throw new Error('Missing required environment variables.');
}

const supabase = createClient(supabaseUrl, serviceKey);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_EXPO_BATCH = 100;

const isExpoToken = (t?: string | null): t is string =>
  !!t && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'));

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const noContent = () => new Response(null, { status: 204, headers: corsHeaders });

async function fetchAllTokens(userId: string): Promise<string[]> {
  const tokens = new Set<string>();

  // Legacy mirror on profiles.push_token
  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('id', userId)
    .maybeSingle();
  if (profErr && profErr.code !== 'PGRST116') {
    console.warn('[push] profiles fetch error:', profErr.message);
  }
  if (isExpoToken(prof?.push_token)) tokens.add(prof!.push_token as string);

  // device_tokens table (preferred)
  const { data: devs, error: devErr } = await supabase
    .from('device_tokens')
    .select('token, revoked_at')
    .eq('user_id', userId);

  if (devErr) {
    console.warn('[push] device_tokens fetch error:', devErr.message);
  } else {
    devs?.forEach((r: any) => isExpoToken(r?.token) && !r?.revoked_at && tokens.add(r.token));
  }

  return Array.from(tokens);
}

async function pruneInvalid(tokens: string[]) {
  if (!tokens.length) return;
  const now = new Date().toISOString();

  // Soft revoke
  const { error: updateErr } = await supabase
    .from('device_tokens')
    .update({ revoked_at: now })
    .in('token', tokens);

  // Fallback: if column is missing, hard delete
  if (updateErr?.message?.includes('column "revoked_at" does not exist')) {
    const { error: delErr } = await supabase
      .from('device_tokens')
      .delete()
      .in('token', tokens);
    if (delErr) console.warn('[push] prune delete error:', delErr.message);
  } else if (updateErr) {
    console.warn('[push] prune update error:', updateErr.message);
  }
}

async function insertBell(userId: string, bell: BellPayload) {
  const { error } = await supabase
    .from('notifications')
    .insert({ user_id: userId, type: bell.type, data: bell.data });
  if (error) console.warn('[push] bell insert error:', error.message);
}

async function sendExpo(toTokens: string[], title: string, body: string, data?: Json) {
  if (!toTokens.length) return { badTokens: [] as string[] };

  const messages = toTokens.map((to) => ({ to, title, body, data }));
  const batches = chunk(messages, MAX_EXPO_BATCH);
  const badTokens: string[] = [];
  const auth = Deno.env.get('EXPO_ACCESS_TOKEN'); // optional

  for (const batch of batches) {
    try {
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

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // ignore body parse errors
      }

      if (!res.ok) {
        console.warn('[push] Expo HTTP error', res.status, json);
        continue;
      }

      const tickets =
        (json?.data as Array<{ status: string; message?: string; details?: { error?: string } }>) ||
        [];

      tickets.forEach((t, i) => {
        if (t?.status === 'error') {
          const tok = batch[i]?.to;
          const code = t?.details?.error;
          if (code === 'DeviceNotRegistered' || code === 'InvalidCredentials') {
            if (tok) badTokens.push(tok);
          }
          console.warn('[push] Expo ticket error', { tok, code, message: t?.message });
        }
      });
    } catch (e) {
      console.warn('[push] Expo request failed:', e);
    }
  }

  return { badTokens };
}

async function handleNotify(reqBody: NotifyRequest) {
  const { userId, title, body, data, bell } = reqBody;

  const tokens = await fetchAllTokens(userId);

  // No tokens → still insert bell (if any) and return 204
  if (!tokens.length) {
    if (bell) await insertBell(userId, bell);
    return noContent();
  }

  const { badTokens } = await sendExpo(tokens, title, body, data);

  if (badTokens.length) await pruneInvalid(badTokens);
  if (bell) await insertBell(userId, bell);

  return ok({ ok: true, sent: tokens.length, pruned: badTokens.length });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return ok({ error: 'Method not allowed' }, 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return ok({ error: 'Invalid JSON body' }, 400);
  }

  try {
    // Primary API
    if (payload?.action === 'notify') {
      if (!payload.userId || !payload.title || !payload.body) {
        return ok({ error: 'Missing required fields: userId, title, body' }, 400);
      }
      return await handleNotify(payload as NotifyRequest);
    }

    // Backward-compat path:
    // Expect payload.record with { id, title, creator } → push to creator only
    if (payload?.record?.id && payload?.record?.creator) {
      const { data, error } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', payload.record.creator)
        .maybeSingle();
      if (error) console.warn('[push] compat profiles error:', error.message);

      const token = data?.push_token;
      if (!isExpoToken(token)) return noContent();

      const msg = {
        to: token,
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

      const j = await res.json().catch(() => ({}));
      return ok(j, res.ok ? 200 : 500);
    }

    return ok({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('[push] Unhandled error:', e);
    return ok({ error: 'Internal error' }, 500);
  }
});
