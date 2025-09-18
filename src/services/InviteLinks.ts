// src/services/InviteLinks.ts
import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@config/supabase';

const STORAGE_KEY = 'pending_invite_payload_v1';

// Public config (safe to ship). You already polyfill URL in App.tsx.
const LINK_HOST =
  (process.env as any)?.EXPO_PUBLIC_LINK_HOST || 'dr-ynks.app.link'; // Branch/Firebase domain
const FALLBACK_WEB =
  (process.env as any)?.EXPO_PUBLIC_MARKETING_URL || 'https://dr-ynks.com/download';
const APP_SCHEME = (process.env as any)?.EXPO_PUBLIC_SCHEME || 'dr-ynks';

type PendingPayload = { code: string; dateId?: string | null; inviterId?: string | null };

// --- Branch helper (no-throw, dynamic import so it won't break dev builds) ---
async function tryCreateBranchLink(code: string, dateId: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Branch = (require('react-native-branch') as any).default || require('react-native-branch');
    const buo = await Branch.createBranchUniversalObject(`invite/${code}`, {
      title: 'Join me on DrYnks',
      contentDescription: 'You’re invited—tap to see the date.',
      contentMetadata: { date_id: dateId, code },
    });
    const { url } = await buo.generateShortUrl(
      { feature: 'invite', channel: Platform.OS, campaign: 'share_invite', stage: 'share' },
      {
        $canonical_identifier: `invite/${code}`,
        $deeplink_path: `invite/${code}`,
        $fallback_url: FALLBACK_WEB,
        code,
        date_id: dateId,
      }
    );
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Create a single-use invite URL for social/text sharing.
 * Prefers the `create_share_invite(p_date_id uuid)` RPC; falls back to inserting
 * into `invite_links` when RLS allows (you already added the insert_self policy).
 */
export async function createShareInviteLink(dateId: string, inviterId: string) {
  let code: string | null = null;

  // 1) Prefer server RPC (uses auth.uid() internally; keeps logic centralized)
  try {
    const { data, error } = await supabase.rpc('create_share_invite', { p_date_id: dateId });
    if (!error && data) {
      code = Array.isArray(data)
        ? ((data[0]?.code as string | undefined) ?? null)
        : (((data as any)?.code as string | undefined) ?? null);
    }
  } catch {
    // ignore, we'll try fallback
  }

  // 2) Optional fallback (requires your RLS policy to allow inviter_id = auth.uid())
  if (!code) {
    try {
      const random = Math.random().toString(36).slice(2, 10).toUpperCase(); // 8 chars
      const { error: insErr } = await supabase
        .from('invite_links')
        .insert([{ code: random, date_id: dateId, inviter_id: inviterId }]);
      if (!insErr) code = random;
    } catch {
      // noop
    }
  }

  if (!code) throw new Error('Could not create invite link');

  // 3) Generate a short link via Branch; otherwise use HTTPS fallback
  const branchUrl = await tryCreateBranchLink(code, dateId);
  const httpsFallback = `https://${LINK_HOST}/invite/${encodeURIComponent(code)}?d=${encodeURIComponent(dateId)}`;
  return { url: branchUrl || httpsFallback, code };
}

/**
 * Robust parser for many common deep-link shapes:
 *  - dr-ynks://invite/ABC123?d=<dateId>
 *  - dr-ynks://invite?code=ABC123&d=<dateId>
 *  - https://dr-ynks.app.link/invite/ABC123?d=<dateId>
 *  - https://dr-ynks.app.link/?code=ABC123&d=<dateId>
 * Also accepts ?invite=<code> as a defensive alias.
 */
export function parseInviteFromUrl(rawUrl: string): PendingPayload | null {
  try {
    const url = new URL(rawUrl);
    const host = (url.host || '').toLowerCase();
    const path = url.pathname || '';

    // Case A: custom scheme like dr-ynks://invite/ABC123 or dr-ynks://invite?code=...
    if (host === 'invite') {
      // When host == 'invite', the code is usually the first path segment, else a query param.
      const seg = path.replace(/^\/+/, '').split('/')[0]; // 'ABC123' from '/ABC123'
      const qpCode = url.searchParams.get('code') || url.searchParams.get('invite');
      const code = seg || qpCode;
      if (code) {
        return {
          code: decodeURIComponent(code),
          dateId: url.searchParams.get('d'),
          inviterId: url.searchParams.get('inviter'),
        };
      }
    }

    // Case B: universal link path https://.../invite/ABC123
    const match = path.match(/\/invite\/([^/?#]+)/i);
    if (match?.[1]) {
      return {
        code: decodeURIComponent(match[1]),
        dateId: url.searchParams.get('d'),
        inviterId: url.searchParams.get('inviter'),
      };
    }

    // Case C: generic query param (?code= or ?invite=) on any path
    const anyCode = url.searchParams.get('code') || url.searchParams.get('invite');
    if (anyCode) {
      return {
        code: anyCode,
        dateId: url.searchParams.get('d'),
        inviterId: url.searchParams.get('inviter'),
      };
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * Capture deep links at boot (cold start + while running) and stash the payload
 * until the user finishes login. App.tsx already calls this once on startup.
 */
export function initInviteDeepLinking() {
  // Initial (cold start)
  Linking.getInitialURL()
    .then((initial) => {
      if (!initial) return;
      const payload = parseInviteFromUrl(initial);
      if (payload) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
    })
    .catch(() => {});

  // Runtime
  const sub = Linking.addEventListener('url', (e) => {
    try {
      const payload = parseInviteFromUrl(e.url);
      if (payload) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
    } catch {
      // noop
    }
  });

  return () => {
    try { sub.remove(); } catch {}
  };
}

/**
 * After login, atomically claim the pending invite (server RPC first; permissive
 * RLS fallback if you keep it turned on) and return { dateId } so the feed can pin it.
 */
export async function consumePendingInviteAfterLogin(): Promise<{ dateId?: string | null } | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    let payload: PendingPayload | null = null;
    try { payload = JSON.parse(raw) as PendingPayload; } catch { payload = null; }
    if (!payload?.code) return null;

    let dateId: string | null = null;

    // 1) Prefer server RPC (you created public.claim_invite_code(text))
    try {
      const { data, error } = await supabase.rpc('claim_invite_code', { p_code: payload.code });
      if (!error && data) {
        dateId = Array.isArray(data)
          ? ((data[0]?.date_id as string | undefined) ?? null)
          : (((data as any)?.date_id as string | undefined) ?? null);
      }
    } catch {
      // ignore, fall back to client-side claim path if allowed
    }

    // 2) Fallback: read from invite_links + insert join_request (requires permissive RLS)
    if (!dateId) {
      const { data: linkRow } = await supabase
        .from('invite_links')
        .select('date_id')
        .eq('code', payload.code)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      const got = (linkRow?.date_id as string | undefined) || null;

      if (got) {
        const { data: dr } = await supabase
          .from('date_requests')
          .select('creator')
          .eq('id', got)
          .maybeSingle();
        const host = (dr?.creator as string | undefined) || null;

        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;

        if (uid) {
          // Mark claimed (idempotent)
          await supabase
            .from('invite_links')
            .update({ claimed_by: uid, claimed_at: new Date().toISOString() })
            .eq('code', payload.code);

          // Create join_request to host (idempotent via onConflict)
          if (host) {
            await supabase
              .from('join_requests')
              .insert([{ date_id: got, requester_id: uid, recipient_id: host, status: 'pending' }])
              .onConflict('date_id,requester_id')
              .ignore();
          }
          dateId = got;
        }
      }
    }

    // Clear stash either way (single-use)
    await AsyncStorage.removeItem(STORAGE_KEY);
    return { dateId };
  } catch {
    return null;
  }
}
