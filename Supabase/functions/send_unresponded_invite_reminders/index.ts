import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabase.rpc('get_unresponded_invites_after_x_hours', {
    hours: 3
  })

  if (error) {
    console.error('❌ RPC error:', error)
    return new Response('RPC failed', { status: 500 })
  }

  for (const invite of data) {
    console.log(`🔔 Reminder: notify ${invite.user_id} at ${invite.user_email} for date ${invite.date_id} on ${invite.event_date}`)
    // TODO: Add real email or push logic here
  }

  return new Response(`✅ Processed ${data.length} pending invite reminders`, { status: 200 })
})
