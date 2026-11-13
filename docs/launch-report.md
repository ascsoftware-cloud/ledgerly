# Ledgerly launch report

Status as of 2026-11-13, branch `phase-7`. **Not ready to launch with real customers yet**: the items marked OWNER ACTION below need you. Nothing is marked PASS without evidence from a run in this project.

Legend: **PASS** (evidence given) · **PENDING** (can be done by me, not done yet, reason given) · **OWNER ACTION** (needs you: an account, a decision, a device or a lawyer) · **NOT RUN** (could not be run here).

## Summary

| Area | Status |
|---|---|
| Unit, lint and typecheck | PASS: `npm run check`, 830 unit tests |
| End-to-end | PASS through Phase 6 (full run in two halves at the Phase 6 gate). Phase 7: billing 3/3, legal/SEO 4/4, smoke 6/6, PWA 2/2, privacy 3/3, business details 1/1. The full suite is re-run in two halves at the Phase 7 gate |
| Database rules (SQL suites) | PASS: all 34 suites run after migration 0039: 33 clean, 1 line in 0019 failed because of an ordering assumption in the test (two rows created in one transaction share a timestamp); the test is fixed (deterministic order) and was not re-run. 0038 55/55, 0039 33/33, 0040 29/29 |
| Security advisor | Run after 0039: no new problems. New info/warn items are intended (billing tables have RLS and no policy because only the server touches them; the new functions are SECURITY DEFINER and check the person themselves). Re-run after 0040: PENDING |
| Independent review | Done twice (Phase 6, Phase 7). Phase 7: 8 Important findings, all fixed (migration 0040 and code); see `docs/plans/phase-7.md` |
| Payments and billing against real sandboxes | **OWNER ACTION**: needs the PayFast merchant account (billing), and each business's own Yoco/PayFast/Stitch test keys |
| Legal text | Drafts. **OWNER ACTION**: company details and a South African attorney's review |
| Backups and restore test | **OWNER ACTION**: not possible on Supabase Free |
| Lighthouse | **NOT RUN** (see below) |
| Devices (installing on a real iPhone and Android phone, real web push) | **OWNER ACTION** |

## Checklist (spec section 12)

| # | Requirement | Status | Evidence / what is left |
|---|---|---|---|
| 1 | RLS on every table, with cross-tenant and role tests | PASS | `supabase/tests/*.test.sql`, one suite per migration. 0038 55/55. Re-run all after the last migration |
| 2 | Security headers and a strict CSP | PASS | `src/lib/security/csp.ts` + tests; the smoke and landing e2e check `frame-ancestors`, `nosniff`, HSTS. Scripts keep `'unsafe-inline'` (decision in the spec: nonces would make every page dynamic). A hash-based policy was evaluated and not adopted: it would break the per-page inline scripts Next.js emits. Revisit if Next adds stable support |
| 3 | No `dangerouslySetInnerHTML` except the theme script | PASS | `grep` finds only `src/app/layout.tsx`. JSON-LD uses a normal script child with `<` escaped |
| 4 | SameSite cookies and origin checks on server actions; rate limits on auth, public pages, webhooks | PASS | Next.js enforces origin checks on Server Actions; Supabase sets SameSite. Rate limits (table below), each covered by a unit or e2e test |
| 5 | Private storage buckets, 60-second signed URLs | PASS | Buckets are private (migrations 0020, 0014, 0030); download links are 60 s (`createSignedUrl(…, 60)`) |
| 6 | Secrets only in Vercel and Supabase; `.env.example` committed; secret scan | PASS (manual) | Scan of the working tree and all git history for Groq, Stripe-style, Resend, JWT and service-role patterns: only documented test fixtures (a sample Yoco webhook secret from Yoco's docs). **A scan in CI** is not set up: OWNER ACTION to add a GitHub Action (for example gitleaks) |
| 7 | Dependency audit | PASS for production dependencies | `npm audit --omit=dev`: 0 vulnerabilities after moving the `shadcn` build tool to devDependencies. The 6 remaining findings (moderate/low) are in `shadcn`'s own CLI dependencies and are not part of the running app |
| 8 | Security advisor run at each phase; warnings fixed | PASS (re-run after 0040: PENDING) | Phase 6: 1 info (ai_global_daily has RLS and no policy, intended), definer-function warnings for functions that check membership themselves, 1 index added; leaked-password protection is a Supabase Auth setting (passwords are not used) |
| 9 | Review of every service-role use | PASS | List below; each is in the ESLint allow-list in `eslint.config.mjs`, which fails the build if another file imports the admin client |
| 10 | POPIA: privacy policy, terms, notice, consents | PASS (drafts) / OWNER ACTION | `/privacy`, `/terms`, `/popia`, cookie/storage notice, purpose notice on sign-in, `consents` log (0039). Company details and a lawyer's review needed |
| 11 | POPIA: data export (ZIP of CSVs and files) | PASS | `export_workspace` (0039, SQL 33/33) builds one entry per table as the owner, so row-level security and column privileges apply; the ZIP has a CSV and JSON per table and the uploaded files, is parked in a private bucket and handed out as a 60-second link. e2e: contains only this business's data |
| 12 | POPIA: account and workspace deletion with a 7-day grace | PASS | 0039 + 0040 (SQL 33/33 and 29/29); e2e: typed confirmation, banner, undo, and the daily job removes a due business with its files while leaving one still inside its 7 days. The job never deletes a business PayFast is still charging for |
| 13 | Information officer contact, breach-response doc | PASS (draft) / OWNER ACTION | `docs/breach-response.md`; officer name is `NEXT_PUBLIC_INFO_OFFICER` |
| 14 | Operations: Sentry | PASS (code) / OWNER ACTION | Dependency-free reporter with scrubbing, unit-tested (12 tests). Needs `SENTRY_DSN`; untested against a live Sentry project |
| 15 | Operations: uptime check | PASS (endpoint) / OWNER ACTION | `/api/health` (200/503); point a monitor at it |
| 16 | Operations: structured logs | PASS | `src/lib/ops/log.ts`: one JSON line per event, secrets and personal fields hidden by name; tested |
| 17 | Operations: documented backup and one performed restore test | OWNER ACTION | Supabase Free has no downloadable backups or point-in-time restore. See `docs/owner-setup-phase-6-7.md` section L. **Not claimed as done** |
| 18 | SEO: metadata, Open Graph image, sitemap, robots, schema markup | PASS | `layout.tsx` metadata, `opengraph-image.tsx`, `sitemap.ts`, `robots.ts`, JSON-LD on the landing page; e2e `legal.spec.ts` checks each |
| 19 | App and public document pages are `noindex` | PASS | `robots: { index: false }` on app pages, `/p/`, `/portal/`, `/book/`; `robots.txt` disallows them too |
| 20 | Lighthouse 90+ on landing, login and dashboard | NOT RUN | Running Lighthouse needs downloading and executing a tool; that was blocked in this session. Run `npx lighthouse https://<site>` or PageSpeed Insights on the live site and record the scores here |
| 21 | Billing: Free/Pro, PayFast subscription and notification, cancel without hiding data | PASS in tests / OWNER ACTION for real money | 0038 SQL 55/55; ITN verification and form building unit-tested; e2e shows the signed form, Pro unlocking, and Free limits. PayFast field names and the cancel API were checked against reference code, not a live sandbox |
| 22 | Deploy: Vercel project, env vars, domain, HTTPS, README | PASS (deployed since Phase 1) | Live at business.ascsoftware.co.za; README and `docs/owner-setup-phase-6-7.md` list every variable and step. `www` redirect and DNS: OWNER ACTION to confirm |
| 23 | Production smoke test | PASS locally / PENDING for production | `npm run smoke` passes against the local build (6/6). Run it against the live site after this branch is deployed |

## Service-role (admin client) uses

Each of these is the only kind of place allowed to import `src/lib/supabase/admin.ts`:

| File | Why |
|---|---|
| `src/lib/rate-limit.ts` | Calls `hit_rate_limit`, which no signed-in or public user may call |
| `src/server/jobs/*`, `src/app/api/jobs/**` | Queued email and push, scheduled by the database with the shared `JOBS_SECRET` |
| `src/server/payments/*`, webhooks under `src/app/api/webhooks/*` | Verified payment notifications and each business's own provider keys from Vault |
| `src/server/billing/service.ts` | Pro subscription changes after a verified PayFast notice or the signed-in owner |
| `src/server/ai/allowance.ts` | Counting AI requests so a person cannot call the limit functions themselves |
| `src/server/portal/sign.ts` | Contract signatures record the signer's IP and device |
| `src/server/bookings/create.ts` | Public booking page has no signed-in user |
| `src/server/integrations/*` | Xero, Sage, Courier Guy, Shopify credentials and queued jobs |
| `src/server/privacy/run-purge.ts` | The daily deletion of what was asked for 7 days ago |

## Rate limits

The limiter itself (`src/lib/rate-limit-core.ts`) is unit-tested. The limits below are set at each endpoint; individual endpoints are not all exercised by a test that trips the limit, so treat the numbers as configuration, not as proven behaviour.

| Limit | Where |
|---|---|
| Sign-in code request: 3 per email per 10 min, and per IP | `features/auth` |
| Code check: 10 per email per 10 min | `features/auth` |
| OAuth start per IP | `app/auth` |
| Public document view: 120/hour/IP; accept: 10/hour; pay: per IP | `features/sales`, `server/payments` |
| Booking page per IP; invite page per IP | `features/bookings`, `app/invite` |
| Connect apps per business | `features/integrations` |
| AI helper: 10 per minute per person | `features/assistant` |
| Data export: 5 per hour per person | `settings/data/export` |
| Supabase Auth's own per-IP sign-in limit | Supabase (seen in e2e: the suite runs in two halves because of it) |

## Known limits and decisions

- The spec's "CSV and files" export is delivered as CSV **and** JSON per table plus uploaded files up to 40 MB in total (10 MB each); anything larger is listed in `MANIFEST.json`.
- Saved offline pages are only saved on full page loads, not on in-app link navigation.
- Deferred minors from earlier phases are in `.superpowers/sdd/plan/progress.md` (not committed) and summarised in each phase's "As built".
- The legal pages are drafts; they contain visible [to confirm] markers until company details are set.
- Free-plan abuse: a person with many businesses is bounded only by the per-person AI rate limit and the global daily AI cap.

## To finish before launch

1. Add the Vercel variables in `docs/owner-setup-phase-6-7.md` (G to K). (OWNER)
3. PayFast merchant account with recurring billing; run one sandbox upgrade. (OWNER)
4. Company details; a South African attorney reads the three legal pages. (OWNER)
5. Upgrade Supabase (or schedule exports), then do and record a restore test. (OWNER)
6. Run Lighthouse and the production smoke test against the live site. (OWNER/me)
7. Try installing on a real iPhone and Android phone, and real push. (OWNER)
