// root/api/notify.js
// Quiet, production-ready handler for notifying a date host via Resend.
// Works in Next.js API routes (export default), Vercel serverless (Node runtime),
// or Express (import { handler } and app.post('/api/notify', handler)).

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// ─── Env ───────────────────────────────────────────────────────────────────────
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL = 'notify@drynks.com', // your verified sender
  RESEND_FROM_NAME = 'DrYnks',
  NOTIFY_CORS_ORIGIN = '*', // set to your domain in prod, e.g. https://api.drynks.com
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Fail fast at boot if server creds are missing
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
}

// Create Resend client only if configured (emails are optional)
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', NOTIFY_CORS_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJSON(res, status, body) {
  cors(res);
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(body);
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function isUUID(v) {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function handler(req, res) {
  // Basic CORS preflight
  if (req.method === 'OPTIONS') {
    cors(res);
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    // Normalize body across runtimes
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { date_id, actor_id, action } = body;

    if (!date_id || !actor_id || !action) {
      return sendJSON(res, 400, { error: 'Missing date_id, actor_id, or action' });
    }
    if (!isUUID(date_id) || !isUUID(actor_id) || typeof action !== 'string') {
      return sendJSON(res, 400, { error: 'Invalid payload format' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Let Postgres compose/log the notification & determine recipient
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'notify_date_host_on_action',
      { date_id, actor_id, action }
    );
    if (rpcError) throw rpcError;

    // 2) Resolve recipient + message (prefer the RPC response; fall back to latest log)
    let recipient_id = rpcData?.recipient_id ?? rpcData?.host_id ?? null;
    let message = rpcData?.message ?? rpcData?.email_body ?? rpcData?.text ?? null;

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
      // Nothing to notify — not an error
      return sendJSON(res, 200, { success: true, note: 'No recipient to notify' });
    }

    // 3) Fetch host contact from profiles (your table uses "screenname")
    const { data: host, error: hostErr } = await supabase
      .from('profiles')
      .select('email, push_token, screenname')
      .eq('id', recipient_id)
      .maybeSingle();
    if (hostErr) throw hostErr;

    // 4) Send email via Resend (soft-fail; log but don’t break request)
    if (host?.email && resend && message) {
      try {
        await resend.emails.send({
          from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
          to: host.email,
          subject: 'Someone joined your date 🎉',
          text: message,
          html: `<p style="font-family:-apple-system,system-ui,sans-serif;font-size:16px;line-height:1.5">${escapeHtml(
            message
          )}</p>`,
        });
      } catch (mailErr) {
        console.error('[api/notify] email send failed:', mailErr);
        // continue; we don’t want email flakiness to break the API call
      }
    }

    // 5) (Optional) Push notification can be sent here using host.push_token

    return sendJSON(res, 200, { success: true });
  } catch (err) {
    console.error('[api/notify] error:', err);
    return sendJSON(res, 500, { error: err?.message || 'Internal Server Error' });
  }
}

export default handler; // Next.js default export
