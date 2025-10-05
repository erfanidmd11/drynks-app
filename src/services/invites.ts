// src/services/invites.ts
import { supabase } from '@config/supabase';

/**
 * Rescind an invite you previously sent.
 * Server-side: public.invites_decide(p_req_id uuid, p_decision text)
 * Must accept 'rescinded' (per your installed RPC).
 */
export async function rescindInvite(reqId: string) {
  if (!reqId) throw new Error('Missing reqId');
  const { data, error } = await supabase.rpc('invites_decide', {
    p_req_id: reqId,
    p_decision: 'rescinded',
  });
  if (error) throw error;
  return data as { ok?: boolean; status?: string } | null;
}
