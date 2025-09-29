// src/services/notifyHost.ts
import { supabase } from '@config/supabase';

export type HostAction = 'requested' | 'accepted' | 'cancelled';

/**
 * Calls the Supabase Edge Function `notify-date-host`.
 * Safe to call; silently no-ops if user/session is missing.
 */
export async function notifyHost(
  dateId: string,
  actorId?: string,
  action: HostAction = 'requested'
): Promise<void> {
  try {
    let uid = actorId;
    if (!uid) {
      const { data } = await supabase.auth.getUser();
      uid = data?.user?.id ?? undefined;
    }
    if (!uid) return;

    const { error } = await supabase.functions.invoke('notify-date-host', {
      body: { date_id: dateId, actor_id: uid, action },
    });

    if (error) console.warn('[notify-date-host] invoke error:', error);
  } catch (e) {
    console.warn('[notify-date-host] invoke threw:', e);
  }
}
