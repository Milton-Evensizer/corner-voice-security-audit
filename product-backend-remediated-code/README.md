# Corner Voice — Remediated Files

These are corrected versions of the files affected by the Critical/High/Medium
findings in [`../docs/CornerVoice_Security_Audit_Report.pdf`](../docs/CornerVoice_Security_Audit_Report.pdf).
Drop each file over its counterpart at the matching path in `server/src/`.

| File | Findings fixed |
|---|---|
| `lib/supabase.js` | F-01 (RLS bypass) |
| `services/ai.js` | F-02 (prompt injection via reviews), F-06 (custom_instructions injection) |
| `services/scraper.js` | F-04 (stored XSS / unsanitized scraped content), F-07 (unvalidated external ID) |
| `middleware/auth.js` | F-05 (non-constant-time secret comparison) |
| `routes/scrape.js` + `index.js` | F-03 (IDOR on job polling) |

## Before you deploy these

1. **`lib/supabase.js`** requires a new environment variable:
   ```
   SUPABASE_ANON_KEY=your-anon-public-key   # Settings > API in Supabase dashboard
   ```
   Add this to `.env`, `.env.example`, and every hosting platform's env config
   (Render/Railway/Fly.io). This is the public/anon key, safe to expose to a
   browser — it is NOT the same secret as `SUPABASE_SERVICE_KEY`.

2. **`services/scraper.js`** requires a new dependency:
   ```
   npm install sanitize-html
   ```

3. **Test the RLS fix carefully.** Since `supabaseForUser()` now genuinely
   enforces Row Level Security, any code path that was silently relying on
   the service-role bypass (intentionally or not) may start returning empty
   results or permission errors. Search the codebase for every call site of
   `supabaseForUser()` and confirm each one is only ever called with a
   legitimately-owned resource. In the reviewed codebase, most routes
   actually use the plain `supabase` (service-role) client with manual
   ownership checks rather than `supabaseForUser()` — if that's still the
   intended long-term pattern, consider removing `supabaseForUser()`
   entirely rather than fixing it, to avoid the confusion that caused F-01
   in the first place. Pick one pattern deliberately: either (a) service-role
   client + manual ownership checks everywhere, or (b) anon-key client with
   RLS as the primary control. Mixing both is what created this gap.

4. **F-02/F-06 fix changes AI output slightly** — the added
   `enforceDiscountPolicy()` post-processing strips discount-related
   sentences from generated replies for 3-5 star reviews. Read through a
   handful of test replies after deploying to confirm it isn't
   over-triggering on legitimate phrases (e.g. a genuinely 5-star review
   that mentions "the discount they already got last time" as customer
   praise — edge case, but worth a quick manual check).

## What was intentionally left as-is

- `routes/businesses.js`, `routes/reviews.js`, `routes/webhooks.js`,
  `services/alerts.js` — these were reviewed and no code changes were
  required; their existing ownership checks and Stripe signature
  verification are correct as written.
- F-08 (webhook secret shared with Apify) has no code fix — it's
  documented as an accepted trust boundary in the audit report.
