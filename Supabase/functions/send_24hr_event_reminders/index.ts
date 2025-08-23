import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

serve(async (req) => {
  const apiKey = req.headers.get('x-api-key')
  const validKey = Deno.env.get('CRON_REMINDER_KEY')!

  if (apiKey !== validKey) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SERVICE_ROLE_KEY')!
  )

  const body = await req.json().catch(() => ({}))
  const hours = body.hours || 24

  const { data, error } = await supabase.rpc('get_accepted_invites_for_24hr_reminder', { hours })

  if (error) {
    console.error('❌ RPC error:', error)
    return new Response(`RPC failed: ${JSON.stringify(error)}`, { status: 500 })
  }

  for (const invite of data) {
    console.log(`📅 ${hours}hr Reminder: Notify ${invite.user_id} at ${invite.user_email} for date on ${invite.event_date}`)
    // TODO: Trigger actual notification
  }

  return new Response(`✅ Sent ${data.length} ${hours}hr reminders`, { status: 200 })
})
