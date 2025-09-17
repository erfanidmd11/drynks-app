// supabase/functions/notify_chat_members.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const { date_id, message } = await req.json();

    if (!date_id || !message) {
      return new Response(JSON.stringify({ error: 'Missing date_id or message' }), { status: 400 });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get chat members
    const { data: dateData, error: dateError } = await supabaseClient
      .from('date_requests')
      .select('chat_members')
      .eq('id', date_id)
      .single();

    if (dateError || !dateData?.chat_members?.length) {
      return new Response(JSON.stringify({ error: 'No chat_members found' }), { status: 404 });
    }

    // Get tokens from profiles
    const { data: profiles, error: profileError } = await supabaseClient
      .from('profiles')
      .select('expo_push_token')
      .in('id', dateData.chat_members);

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), { status: 500 });
    }

    const tokens = profiles
      .map(p => p.expo_push_token)
      .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'));

    if (tokens.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid push tokens found' }), { status: 404 });
    }

    // Send push via Expo
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        tokens.map(token => ({
          to: token,
          sound: 'default',
          title: 'DrYnks Chat 💬',
          body: message,
          data: { date_id },
        }))
      ),
    });

    const pushResult = await expoRes.json();

    return new Response(JSON.stringify({ success: true, pushResult }), { status: 200 });
  } catch (err) {
    console.error('[notify_chat_members error]', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
