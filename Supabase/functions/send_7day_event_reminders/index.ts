import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('CRON_REMINDER_KEY')!
  )

  const { data, error } = await supabase.rpc('get_accepted_invites_for_7day_reminder')

  if (error) {
    console.error('❌ RPC error:', error)
    return new Response('RPC failed', { status: 500 })
  }

  for (const invite of data) {
    console.log(`📅 7-Day Reminder: Notify ${invite.user_id} at ${invite.user_email} for date on ${invite.event_date}`)

    const { error: pushError } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', invite.user_id)
      .single()
      .then(async ({ data: tokenRow }) => {
        if (tokenRow?.token) {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: tokenRow.token,
              title: '⏳ 7-Day Reminder',
              body: `You've got a date coming up on ${new Date(invite.event_date).toLocaleDateString()}`,
            }),
          })
          if (!res.ok) console.error('Expo push error:', await res.text())
        } else {
          console.warn(`⚠️ No push token for user ${invite.user_id}`)
        }
      })

    if (pushError) console.error('Push token fetch error:', pushError)
  }

  return new Response(`✅ Sent ${data.length} 7-day reminders`, { status: 200 })
})
