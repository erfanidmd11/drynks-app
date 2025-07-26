import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: expiredDates, error } = await supabase
    .from("date_requests")
    .select("id")
    .lt("event_date", cutoff)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const expiredIds = expiredDates.map((d) => d.id)

  if (expiredIds.length > 0) {
    const { error: deleteErr } = await supabase
      .from("chat_messages")
      .delete()
      .in("date_id", expiredIds)

    if (deleteErr) return new Response(JSON.stringify({ error: deleteErr.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ deleted_for: expiredIds }), { status: 200 })
})
