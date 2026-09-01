const { createClient } = require('@supabase/supabase-js');

// ── Service-role client ─────────────────────────────────────────
// Bypasses RLS for trusted, server-only operations: webhook handlers,
// cron jobs, and anywhere the caller is the SYSTEM, not a specific user.
// NEVER expose SUPABASE_SERVICE_KEY to the browser, and never use this
// client on the request path for user-facing reads/writes — use
// supabaseForUser() below instead so RLS stays a real backstop.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ── User-scoped client factory ──────────────────────────────────
// FIX (F-01): this must use the ANON key, not the service key.
// RLS enforcement in Supabase is determined by which API key the
// client is built with — the service-role key bypasses RLS no
// matter what Authorization header is attached on top of it.
// Using the anon key here means requests actually run as the
// authenticated user from Postgres's point of view, so the RLS
// policies defined in the schema (owner_id = auth.uid()) become a
// genuine second layer of defense instead of a decorative one.
function supabaseForUser(accessToken) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,   // <-- was SUPABASE_SERVICE_KEY
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
}

module.exports = { supabase, supabaseForUser };
