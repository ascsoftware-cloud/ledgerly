# Security incident and breach response

A short runbook for when personal information may have been accessed, lost or changed by someone who should not have been able to. It is written for a very small team: one person can follow it alone. It is a draft for the owner and their lawyer to confirm.

POPIA section 22 requires the responsible party to tell the Information Regulator and the people affected **as soon as reasonably possible** after finding out. Ledgerly is the *operator* for what a business stores in it and the *responsible party* for account details: either way, tell the affected business owners straight away so that they can meet their own duty.

## Roles

| Role | Who | Does |
|---|---|---|
| Incident lead | The owner (information officer: see the POPIA page) | Decides, communicates, signs off |
| Technical responder | Whoever has Vercel and Supabase access | Contains and investigates |

## 1. Detect

Signals: an alert from Sentry or the uptime monitor; a business reporting something wrong; unusual rows in `rate_limits`, `payment_events`, `audit_log` or the Vercel logs; a provider telling us about an incident; a security researcher writing to the contact address.

Write down the time you found out and who told you. Start an incident note (a dated file in a private place, not in the repository) and add to it as you go.

## 2. Contain (within the hour)

- Stop the leak first, investigate second: revoke or rotate the affected secret (Vercel environment variable, Supabase service-role key, `JOBS_SECRET`, PayFast passphrase, VAPID keys, Groq key), then redeploy.
- Suspect a stolen sign-in session: in Supabase, Authentication, sign out the user's sessions.
- Suspect a bug exposing data: switch the affected feature off (for the AI helper, businesses can switch it off in Settings; a deploy can remove the route) and redeploy.
- Keep evidence: do not delete logs. Export the relevant Vercel log lines and Supabase logs.

## 3. Assess

Answer, in writing:

1. What information, whose, how many people, which businesses?
2. Was it only viewed, or also copied, changed or deleted?
3. How long was it exposed, and how did it happen?
4. Is it still happening?
5. Could the people affected be harmed (fraud, identity theft, embarrassment)? Financial details, ID numbers and contact details raise the risk.

Row-level security means a bug usually exposes one business to another rather than everything to the public: check `supabase/tests` for the table involved and add a failing test that reproduces the problem before fixing it.

## 4. Notify

If there are reasonable grounds to believe personal information was accessed or acquired by an unauthorised person:

1. **Businesses affected:** email each owner the same day. Say what happened, what information, what we have done, and what they should do (for example warn their clients).
2. **The Information Regulator:** report through the Regulator's online portal (inforegulator.org.za) as soon as reasonably possible. Include the assessment above.
3. **The people affected:** if their identity is known, tell them directly in plain words: what happened, what information, what we are doing, what they can do to protect themselves, and who to contact. The Regulator may ask us to publish a notice instead if we cannot reach them.
4. **Others:** the payment provider if card or payment data may be involved; the police if a crime was committed.

Do not delay a notice to finish the investigation: send what is known and follow up.

## 5. Recover and learn

- Fix the cause, with a test that would have caught it.
- Run `npm run check`, the SQL suites in `supabase/tests`, and the Supabase security advisor.
- Rotate anything that may have been seen.
- Within a week write a short review: what happened, why, what changed. Keep it with the incident note.
- Update this runbook and the privacy policy if anything about how we handle data has changed.

## 6. Record

Keep, for at least five years: the incident note, timeline, assessment, what was sent to whom and when, and the review.

## Contacts

Filled in by the owner: information officer, lawyer, Supabase and Vercel support links, the Regulator's portal login.
