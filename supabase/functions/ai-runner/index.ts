// Supabase Edge Function: ai-runner
// Deploy with:  supabase functions deploy ai-runner
// Schedule in the dashboard (Database → Cron) or with `supabase functions schedule`.
//
// Env (set via `supabase secrets set`):
//   APP_URL            e.g. https://your-app.vercel.app
//   SUPABASE_SERVICE_ROLE_KEY  (same as the app's service role key)
//
// The function pings the app's /api/ai-manager/autonomous endpoint for each
// routine type; the app enumerates users with an active scheduled job of that
// type and runs the AI manager on their behalf (service-role, bypassing RLS).

import { serve } from "https://esm.sh/std@0.168.0/http/server.ts";

const ROUTINES = ["morning_optimization", "budget_pacing", "anomaly_detection", "weekly_report"] as const;

serve(async () => {
  const appUrl = Deno.env.get("APP_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!appUrl || !serviceRole) {
    return new Response(JSON.stringify({ error: "APP_URL and SUPABASE_SERVICE_ROLE_KEY must be set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const results: Record<string, unknown> = {};
  for (const routine of ROUTINES) {
    try {
      const res = await fetch(`${appUrl}/api/ai-manager/autonomous`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-role": serviceRole,
        },
        body: JSON.stringify({ routine }),
      });
      results[routine] = { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    } catch (e) {
      results[routine] = { error: e instanceof Error ? e.message : "failed" };
    }
  }

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
