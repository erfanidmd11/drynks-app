// supabase/functions/notify_chat_members/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import type { Handler } from "https://deno.land/std@0.177.0/http/server.ts"

Deno.serve<Handler>(async (req) => {
  try {
    const payload = await req.json()
    const dateId = payload.date_id as string
    const screenname = payload.screenname as string || "Someone"
    const message = payload.message as string || `🥂 ${screenname} just joined the chat. Let the pregame begin!`

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Fetch chat members with their expo push tokens
    const { data: members, error: memberErr } = await supabase
      .from("date_requests")
      .select("chat_members")
      .eq("id", dateId)
      .single()

    if (memberErr) throw memberErr

    const chatUserIds: string[] = members?.chat_members || []

    if (chatUserIds.length === 0) {
      return new Response(JSON.stringify({ count: 0 }), { status: 200 })
    }

    const { data: profiles, error: profileErr } = await supabase
      .from("profiles")
      .select("id, expo_push_token")
      .in("id", chatUserIds)

    if (profileErr) throw profileErr

    const tokens = profiles
      .map((p) => p.expo_push_token)
      .filter((t): t is string => !!t)

    if (tokens.length === 0) {
      return new Response(JSON.stringify({ count: 0, error: "no tokens" }), { status: 200 })
    }

    // Optionally insert a system message into chat_messages
    await supabase.from("chat_messages").insert({
      content: message,
      user_id: "system-bot",
      date_id: dateId,
      system: true,
      created_at: new Date().toISOString(),
    })

    // Send push via Expo
    const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("EXPO_ACCESS_TOKEN")}`,
      },
      body: JSON.stringify({
        to: tokens,
        sound: "default",
        body: message,
        data: { dateId },
      }),
    })
    const expoJson = await expoRes.json()

    return new Response(JSON.stringify({ count: tokens.length, expo: expoJson }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  } catch (err: any) {
    console.error("Error notify_chat_members:", err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
