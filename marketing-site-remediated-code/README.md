# Marketing Site — Round 2 Red-Team Findings

This folder holds the specific files adversarially tested in Round 2 (see
[`../docs/CornerVoice_RedTeam_Round2_Addendum.pdf`](../docs/CornerVoice_RedTeam_Round2_Addendum.pdf)
for the full report). Kept separate from
[`../product-backend-remediated-code/`](../product-backend-remediated-code/)
intentionally — this is a different deployed system (the public marketing
website and its supporting API), not the main Corner Voice product.

## Two Real Fixes in This Folder

**`frontend/tryit.js`** — fixes a DOM-based XSS. The `chip()` function
interpolated a class-name value into an HTML attribute without escaping.
Worth knowing if you're skimming this: the *first* fix attempt used the
wrong escaping function for this context (`escapeHtml()`, which is correct
for text content but doesn't escape quote characters, so it doesn't
protect an attribute value) — re-attacking the "fixed" code with the
identical payload showed it was still exploitable. The version in this
folder is the *corrected* fix (`escapeAttr()`), verified via direct DOM
attribute inspection and an actual simulated mouse-hover interaction
producing zero script execution. The full story, including the failed
first attempt, is in the Round 2 report rather than only showing the
clean final state.

**`backend/src/index.js`** — fixes a missing `trust proxy` configuration.
Not an exploitable vulnerability — a reliability defect that would have
silently broken the public demo's rate limiting for every real visitor
once deployed behind Render (all visitors would have resolved to the same
proxy IP, making the "5 requests/hour/visitor" limit become "5
requests/hour, shared across all site traffic").

## Everything Else Here

`backend/src/middleware/rateLimiter.js`, `verifyTurnstile.js`, and
`backend/src/routes/contact.js`, `demo.js` are included for completeness —
they were adversarially tested in Round 2 (CORS bypass attempts, injection
attempts, type-confusion attacks) and held without needing any code
changes. Included so the full tested surface is visible, not just the
files that changed.

## What Round 2 Could Not Confirm

The reverse-proxy fix above is confirmed correct in mechanism (verified
locally), but the specific production trust boundary — that only Render's
real proxy, not an external attacker connecting directly, can set the
trusted header — can only be fully adversarially confirmed once this is
actually deployed behind Render. Named explicitly in the Round 2 report
rather than assumed.
