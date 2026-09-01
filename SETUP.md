# Pushing This to GitHub

You have everything needed for a repo — just wire it up:

```bash
# 1. Fill in your real name in README.md and LICENSE first (search for
#    "Evensizer" — a few spots still have this placeholder)

# 2. Create the repo on GitHub (via the web UI), suggested name:
#    corner-voice-security-audit

# 3. From this folder:
git init
git add .
git commit -m "Corner Voice AppSec + AI security audit"
git branch -M main
git remote add origin https://github.com/Milton-Evensizer/corner-voice-security-audit
git push -u origin main
```

## Before you push — a few real checks, not just formatting

* \[ ] Search every file for "Evensizer" and replace with your actual name
(`grep -rn "Your Last Name" .`)
* \[ ] Add your real LinkedIn/GitHub URLs in the README footer (currently `(#)` placeholders)
* \[ ] Double-check no real Supabase URLs, Apify actor IDs, API keys, or real
domain/deployment URLs are anywhere in `product-backend-remediated-code/`
or `marketing-site-remediated-code/` — everything currently in there is
clean, but do your own final pass since you know your actual `.env`
values and I don't
* \[ ] Turn on Issues for the repo (Settings → Features → Issues) since the README
invites people to open one
* \[ ] Consider adding a repo description + topics on GitHub itself: something like
`appsec` `ai-security` `llm-security` `prompt-injection` `owasp` `nodejs`
— topics are how this gets discovered by people searching, not just found
by people who already have your link

## Optional next steps

* Pin this repo on your GitHub profile (Profile → Customize your pins) so it's
one of the first things anyone sees.
* Cross-post the README content (or a trimmed version) to Dev.to or Hashnode —
same content, wider reach, and it links back here.
* When you apply to AppSec / AI Security roles, link this repo directly in
your resume and cover letter rather than just mentioning "I did a security
audit" — the artifact is the point.

