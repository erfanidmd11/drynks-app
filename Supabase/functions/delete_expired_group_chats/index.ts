import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: expiredDates, error } = await supabase
    .from('date_requests')
    .select('id')
    .lt('event_date', oneWeekAgo)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  const expiredIds = expiredDates.map(d => d.id)

  if (expiredIds.length > 0) {
    await supabase
      .from('chat_messages')
      .delete()
      .in('date_id', expiredIds)

    // Optional: mark chat closed or notify creator
  }

  return new Response(
    JSON.stringify({ status: 'deleted', expired_date_ids: expiredIds }),
    { status: 200 }
  )
})
