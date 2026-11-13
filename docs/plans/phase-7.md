# Phase 7 — Billing, POPIA, security pass, SEO, operations, launch

Expands Phase 7 of `docs/plan.md`. Spec: `docs/spec.md` §8.2 (plans and billing), §12 (security, privacy, launch), §13 (testing). Migrations continue at 0038.

## Owner needs (the build never blocks on these; each is a clearly named step in the launch report)

- **PayFast merchant account** with subscriptions (recurring billing) enabled, a passphrase set, and its merchant id and key as `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`; `PAYFAST_MODE=sandbox` until real money is wanted. Until set, the upgrade button says billing is not switched on.
- **Pro price:** R199 per workspace per month (spec). It lives in `src/lib/plans.ts`; the owner confirms or changes it there.
- **Company details** for the legal pages and footer (registered name, registration number, address, information officer), as `NEXT_PUBLIC_COMPANY_*` variables. Legal text is a **draft for the owner's lawyer**; it is not legal advice.
- **Sentry** DSN (optional, `SENTRY_DSN`), an uptime monitor pointed at `/api/health`, Supabase backups (not available on the Free Supabase plan: see 7.5).

## PayFast subscription facts used (checked 2026-11-13)

Verified from the PayFast Omnipay reference implementation and PayFast's API reference; the PayFast developer site renders client-side so its text could not be fetched directly. **Treat as unverified against a live sandbox until the owner's merchant account exists.**

- Checkout form adds, after `payment_method` and in this order: `subscription_type` (1 = subscription), `billing_date`, `recurring_amount` (minimum 5.00; defaults to `amount`), `frequency` (3 = monthly), `cycles` (0 = until cancelled). They join the signature in that position; the passphrase is required for recurring billing.
- The ITN for a subscription carries a `token`, to be kept for later API calls. A payment is `payment_status=COMPLETE`.
- Cancelling: `PUT https://api.payfast.co.za/subscriptions/:token/cancel` with `merchant-id`, `version`, `timestamp` and `signature` headers (MD5 of the header values and passphrase, alphabetical by name); `?testing=true` in sandbox. The customer is emailed by PayFast.

## Design rulings

**7.1 Billing (0038).** `subscriptions` (one per workspace; owners read status, never the PayFast token), `billing_checkouts` (one per upgrade attempt; its id is the `m_payment_id`, so an ITN can only apply to a checkout we made) and `billing_events` (unique per `pf_payment_id`: the same ITN twice is one payment). A verified COMPLETE ITN for the exact price turns the workspace `pro` and sets `current_period_end` one month on from the later of now and the previous end. Cancelling (our button, or PayFast telling us) sets `cancelling`: Pro stays until `current_period_end`, then a daily job returns the workspace to Free. **Downgrade never hides or deletes data**: viewing and exporting always work; Free limits only stop *new* sends, automations, uploads beyond 200 MB, and extra workspaces. Entitlements: Pro = unlimited documents (already in the database), 300 AI requests (already), automations, customer portal, hiding the "Sent with Ledgerly" footer, multiple workspaces, 10 GB storage. Where a limit can be a database rule it is (automations, portal links, workspace count, document sends); storage is checked by the server before an upload because Supabase storage rows are not ours to put triggers on. Only owners can start or cancel a subscription (spec §3).

**7.2 Security pass.** Every SQL suite re-run, advisors read, `npm audit`, a secret scan of the working tree and git history, a list of every service-role import with its reason, CSP reviewed, rate limits listed with where they are tested. Results in `docs/launch-report.md`. CSP keeps `'unsafe-inline'` for scripts (documented since Phase 1: nonces would make every page dynamic); any tightening is recorded as a ruling, not forced.

**7.3 POPIA.** `/privacy`, `/terms`, `/popia` (PAIA manual pointer and information officer) as **drafts with the owner's details as variables**. A notice banner (essential cookies only, so no consent choice is faked) recorded in `consents` for signed-in people. Data export: owners get a ZIP of every table's rows for their workspace (found dynamically from the schema by a database function that runs as them, so row-level security limits it) plus their uploaded files up to a size cap. Deletion: owner requests deletion of a workspace; it is hidden from nobody but is scheduled for 7 days later, can be cancelled in that time, and then a job removes rows and storage objects. Account deletion: the same grace for the person's account and the workspaces only they belong to; a workspace with other people must have them removed or ownership handed over first. Breach-response runbook in `docs/breach-response.md`.

**7.4 Performance and SEO.** Page metadata, generated Open Graph image, `sitemap.xml`, `robots.txt`, JSON-LD (Organization and SoftwareApplication) on the landing page, a `/pricing` page that reads the same plan config as billing. Lighthouse is run locally against a production build if a Chrome is reachable; otherwise recorded as not run.

**7.5 Operations.** `/api/health` (database reachable; no secrets in the reply) for an uptime monitor. Structured JSON logging helper and a server error hook that logs and, when `SENTRY_DSN` is set, reports to Sentry. Backups: Supabase Free has no downloadable backup or point-in-time restore, so a restore test cannot be performed on this plan; the launch report marks it **owner action** (upgrade the project or schedule exports) rather than claiming a test that did not happen.

**7.6 Deploy.** The app is already deployed on Vercel at business.ascsoftware.co.za; the README gains a complete variable table and deploy steps, and a smoke e2e that can run against any `BASE_URL` (read-only requests).

**7.7 Launch report.** Every item of the spec's launch checklist marked pass, fail or owner action, with the evidence.

## Tasks

1. **7.1 Billing** — 0038, plan config, checkout, ITN route, plan page, gating, pricing page.
2. **7.3 POPIA** — legal pages, notice banner, consents, export, deletion with grace, breach doc.
3. **7.4 SEO** — metadata, OG image, sitemap, robots, schema markup, Lighthouse attempt.
4. **7.5 Operations** — health, logging, error hook.
5. **7.2 Security pass** and **7.6 Deploy** — audits, README, smoke.
6. **7.7 Launch report**, final review, merge.

Each task: SQL test first for database rules, unit tests for pure helpers, an e2e where a journey exists, commit. Full e2e in two halves at least five minutes apart.
