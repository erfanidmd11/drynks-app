// supabase/functions/notify-date-host/index.ts
// Deno runtime — deploy with: supabase functions deploy notify-date-host
// Set secrets: supabase secrets set --env-file ./supabase/.secrets

import sgMail from 'npm:@sendgrid/mail@8.1.5';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------- Env ----------
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY') || '';
const SENDGRID_FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') || 'notify@drynks.app';
const SENDGRID_FROM_NAME = Deno.env.get('SENDGRID_FROM_NAME') || 'DrYnks';
const NOTIFY_CORS_ORIGIN = Deno.env.get('NOTIFY_CORS_ORIGIN') || '*';

// Initialize SendGrid only if key present
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// ---------- Helpers ----------
const corsHeaders = {
  'Access-Control-Allow-Origin': NOTIFY_CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
} as const;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function isUUID(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // Guard required server env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Server not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const { date_id, actor_id, action } = payload ?? {};

    if (!isUUID(date_id) || !isUUID(actor_id) || typeof action !== 'string' || !action.trim()) {
      return json(400, { error: 'Missing or invalid date_id, actor_id, or action' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Let your RPC compose a log/notification row
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'notify_date_host_on_action',
      { date_id, actor_id, action }
    );
    if (rpcError) throw rpcError;

    // Expected from RPC (but we’ll be defensive)
    let recipient_id: string | null =
      rpcData?.recipient_id ?? rpcData?.host_id ?? null;
    let message: string | null =
      rpcData?.message ?? rpcData?.email_body ?? rpcData?.text ?? null;

    // 2) Fallback to notifications_log if RPC doesn’t return message/recipient
    if (!recipient_id || !message) {
      const { data: logRow, error: logErr } = await supabase
        .from('notifications_log')
        .select('recipient_id, message, created_at')
        .eq('date_id', date_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (logErr) throw logErr;

      recipient_id = recipient_id || logRow?.recipient_id || null;
      message = message || logRow?.message || null;
    }

    if (!recipient_id) {
      // Nothing to notify; not an error
      return json(200, { success: true, note: 'No recipient' });
    }

    // 3) Fetch host profile to get email (and push token if needed)
    const { data: host, error: hostErr } = await supabase
      .from('profiles')
      .select('email, push_token, screenname')
      .eq('id', recipient_id)
      .maybeSingle();
    if (hostErr) throw hostErr;

    // 4) Send email if SendGrid configured and email exists
    let emailSent = false;
    if (SENDGRID_API_KEY && host?.email) {
      await sgMail.send({
        to: host.email,
        from: { email: SENDGRID_FROM_EMAIL, name: SENDGRID_FROM_NAME },
        subject: 'Someone joined your date 🎉',
        text: message || '',
        html: `<p style="font-family: -apple-system, system-ui, sans-serif; font-size:16px; line-height:1.5">${escapeHtml(message || '')}</p>`,
      });
      emailSent = true;
    }

    // TODO: push notification using host.push_token (Expo push, FCM, etc.)

    return json(200, { success: true, emailSent, recipient_id, action });
  } catch (e) {
    console.error('[notify-date-host] error', e);
    return json(500, { error: String(e?.message || e) });
  }
});
