# Ledgerly — product spec (v1)

Date: 2026-11-12. Status: awaiting owner review. Working name; rename freely.

## 1. Purpose

Ledgerly is a paid SaaS for South African small businesses (1–20 people) that replaces the usual pile of invoicing app, spreadsheet, task board and WhatsApp threads with one mobile-first app. It is sold to other businesses on a flat Free/Pro model.

**Success for v1**
- A new visitor goes landing page → onboarding → first invoice sent in under 3 minutes.
- Every table has row-level security (RLS), with tests proving one workspace cannot read or write another's rows.
- Lighthouse ≥ 90 on performance, accessibility, best practices and SEO.
- The launch checklist in section 12 is implemented and reported pass/fail.

**Owner decisions recorded**
- Commercial SaaS, not an internal tool.
- Sign-in is Google or email only (magic link / 6-digit code). No passwords, no Apple, no other providers.
- Payment processors: Yoco and PayFast only.
- Email: Resend.
- AI: a free-tier API, not Claude (see 8.3).
- Running costs must stay near zero until there is revenue: Supabase, Vercel, Resend and the AI provider all start on free tiers.

## 2. Architecture

- **Frontend:** Next.js App Router, TypeScript (strict), Tailwind, shadcn/ui, Framer Motion. Deployed on Vercel.
- **Backend:** Supabase — Postgres, Auth (PKCE via `@supabase/ssr`), Storage, Realtime, Edge Functions, pg_cron, Vault.
- **Security boundary:** RLS. Server components and server actions use the signed-in user's session; the database decides access. The service-role key is used only by (a) payment webhook handlers, (b) the scheduled outbox/automation worker, (c) account deletion. It never reaches the browser.
- **Validation:** every server action and route handler parses input with Zod before touching the database. Queries go through the Supabase client or SQL functions with parameters; no string-built SQL.
- **Locale:** en-ZA, ZAR, Africa/Johannesburg. Money is stored as integer cents plus a `currency` column so multi-currency can be added later without a migration of amounts.
- **PWA:** web manifest, service worker (offline shell + read-only cache of last-viewed lists), install button, web push. No server-only assumptions in client components, so Capacitor can wrap the hosted app later.

### Code layout

```
src/app/(marketing)      landing, pricing, legal pages
src/app/(onboarding)     /start flow
src/app/(auth)           /login, /auth/callback, /auth/confirm
src/app/(app)/[ws]/...   signed-in app, one folder per module
src/app/p/[token]        public document page (invoice / quote / contract)
src/app/book/[slug]      public booking page
src/app/portal/[token]   customer portal
src/app/api/webhooks/{yoco,payfast}
src/features/<module>    actions.ts, queries.ts, schema.ts (Zod), components/
src/lib                  supabase clients, money, dates, rate-limit, ai, payments
supabase/migrations      SQL migrations, each with a matching down script
supabase/functions       edge functions (outbox worker, automations, reminders)
supabase/tests           RLS tests
```

Each feature folder owns its schema, queries and actions; modules talk to each other only through those exports.

## 3. Tenancy and roles

- `workspaces` and `memberships(user_id, workspace_id, role)`.
- Roles: **Owner** (everything, billing, delete workspace), **Admin** (everything except billing and deletion), **Staff** (create and edit operational records; no reports, team, settings or payment keys), **Accountant** (read-only on everything financial; can export).
- Two SQL helpers in a non-exposed schema: `is_member(workspace_id)` and `has_role(workspace_id, roles[])`. Every policy is written with them.
- Every table carries `workspace_id` with an index. Foreign keys are indexed.
- A user can belong to several workspaces; a switcher sits at the top of the sidebar. The active workspace is in the URL (`/[ws]/…`), never in hidden state.

## 4. Authentication

- `/login` shows two buttons: **Continue with Google** and **Continue with email**. Email is the only text field in the product's auth.
- Email sends one message containing both a magic link and a 6-digit code; the screen then shows a code input so the user can finish on the same device.
- Rate limits: 3 requests per email per 10 minutes and 10 per IP per hour, enforced in a server action before calling Supabase, on top of Supabase's own limits.
- On first sign-in, onboarding answers in localStorage are sent to `provision_workspace` (section 5.3).
- The owner set-up checklist (Google OAuth client, redirect URLs, SMTP sender with SPF/DKIM/DMARC) is delivered in the README at the start of Phase 2.

## 5. Onboarding

### 5.1 Rules
One question per screen. Big tappable cards (minimum 44px targets). Progress bar on top, back arrow, mascot with a one-line reaction, sound and haptic toggles (both respect reduced-motion and default to sound off). Slide transitions of 200ms. Nothing is typed until the email at the end. Answers save to localStorage on every tap and survive a refresh.

### 5.2 Script
Mascot: **Miko**, a meerkat (stands up and keeps watch — fitting for a business look-out).

| # | Question | Type | Options | Miko says |
|---|---|---|---|---|
| 1 | What are you building? | single | Service business · Online store · Freelancer · Agency · Restaurant or food · Trades · Other | "Love it. Let's get you set up." |
| 2 | How big is the team? | single | Just me · 2–5 · 6–20 · 20+ | Just me: "Nice, a one-person army!" · others: "A crew! I'll set up roles." |
| 3 | What's your biggest headache? | multi | Getting paid · Tracking money · Finding clients · Managing tasks · Stock · Admin and paperwork | "Noted. We'll tackle that first." |
| 4 | What do you want to manage first? | multi | Invoices · Clients · Projects · Expenses · Inventory · Team · Bookings | "Good picks. I'll switch those on." |
| 5 | How do you get paid today? | multi | Cash · EFT · Card · Yoco · PayFast · Not yet | Not yet: "We'll fix that." · others: "Easy. I'll add those to your invoices." |
| 6 | Roughly what comes in each month? | single | Not yet · Under R20k · R20k–R100k · R100k–R500k · R500k+ | "Thanks. This sets your first goal." |
| 7 | Pick your vibe | single + mode | 6 accent colours × light/dark, live preview card | "Looking sharp." |
| 8 | How long each day? | single | 5 min · 10 min · 15 min | "Deal. I'll keep you on track." |
| 9 | Save your workspace | auth | Continue with Google · Continue with email | "Last step. No password, ever." |

### 5.3 Provisioning
After sign-in, a "Building your workspace…" screen shows real steps ticking as they complete. One database function, `provision_workspace(answers)`, runs in a single transaction:
1. Creates the workspace (name defaults to "<first name>'s business", editable later) and the Owner membership.
2. Enables modules from Q4, plus Invoices and Clients always. Q1 adds defaults: Online store/Restaurant → Inventory; Service/Trades → Bookings; Agency/Freelancer → Projects.
3. Applies theme and accent from Q7.
4. Sets invoice defaults: accepted payment methods from Q5, VAT off (toggle in settings; 15% when on), numbering `INV-0001`.
5. Sets a monthly revenue goal from Q6 (midpoint of the range, rounded up) and a daily reminder from Q8.
6. Creates the setup quest from Q3 and Q4 (section 9).
7. Seeds default expense categories and pipeline stages.
8. If Q2 is more than "Just me", adds "Invite your team" to the quest.

The function is idempotent per user: a second call returns the existing workspace. Sample data is offered on the dashboard as "Show me with example data" and is removable in one tap.

## 6. Modules (v1 depth)

"v1" is what must work. "Later" is explicitly out.

### 6.1 Dashboard
Cash in / cash out this month, revenue vs expenses (6 months), overdue invoices, today's tasks, upcoming bookings, setup quest, revenue goal ring, streak, and a "Needs attention" card. The card is rule-based (overdue invoices, low stock, quotes about to expire, tasks due) and works with no AI; the AI summary is an optional layer on top.

### 6.2 Clients (CRM)
Contacts and companies, tags, notes, activity timeline (auto-logged from invoices, quotes, payments, bookings, tasks), kanban pipeline of deals with stages, CSV import with column mapping and preview.
Later: email sync, lead capture forms.

### 6.3 Invoices and quotes
- Line items from free text or the product list; per-line VAT (15% or 0%); discounts; deposits (percentage or amount); notes and terms.
- Sequential, gapless numbering per workspace, issued by the database at send time. Wording switches to "Tax invoice" with the VAT number when VAT is on.
- Quote → invoice in one tap. Credit notes against an invoice. Recurring invoices (weekly/monthly/yearly) generated by a scheduled job.
- Three PDF templates, generated server-side.
- Public page `/p/[token]`: view, download, accept and sign a quote, pay an invoice.
- Send by email (outbox) or WhatsApp share link with pre-filled message.
- Automatic reminders (before due, on due, after due).
- Statuses: draft, sent, viewed, part-paid, paid, overdue, void.

### 6.4 Payments
- Each workspace connects its own Yoco and/or PayFast merchant account in Settings → Payments. Keys are stored in Supabase Vault and readable only by server code.
- **Yoco:** create a checkout via the Checkout API, redirect to hosted page; webhook verified with HMAC-SHA256 over id, timestamp and raw body, 3-minute tolerance.
- **PayFast:** signed redirect to hosted checkout; ITN verified by signature, source check and server-to-server validation. Exact rules to be confirmed against PayFast's official documentation in Phase 3 before code is written.
- **EFT:** bank details on the invoice; "Mark as paid" with optional proof upload. Also cash and "other".
- Webhook events are stored with a unique `(provider, event_id)`; applying a payment is idempotent. Unverified webhooks are rejected and logged.
- Ledgerly never holds funds and never sees card data.

### 6.5 Expenses
Quick add (amount, category, photo), receipt upload to a private bucket, OCR pre-fill of supplier, date, total and VAT (section 8.3; manual entry always works), categories, recurring costs, bank CSV import with duplicate detection and match-to-invoice suggestions.
Later: live bank feeds.

### 6.6 Projects and tasks
Projects linked to a client; tasks with subtasks, assignee, due date, priority; kanban, list and calendar views over the same data; time tracking (timer and manual); billable hours → draft invoice in one tap.
Later: Gantt, dependencies.

### 6.7 Inventory
Products and services with SKU, cost and price; stock levels adjusted by invoices, purchase orders and manual adjustments (every change is a row in `stock_movements`); low-stock alerts; suppliers; purchase orders (draft, sent, received).
Later: multiple locations, variants, barcode scanning.

### 6.8 Bookings
Services with duration and price, weekly availability, buffer times, public booking page `/book/[slug]`, confirmation and reminder messages, calendar view, .ics download.
Later: Google Calendar two-way sync, deposits at booking.

### 6.9 Team
Invite by email (invited person signs in with Google or email like anyone else), roles, remove member, activity log.

### 6.10 Reports
Profit and loss, cash-flow forecast (next 90 days from due invoices, recurring invoices and recurring costs), aged debtors, VAT summary per period, each with CSV and PDF export. Visible to Owner, Admin and Accountant.

### 6.11 Documents
Folders and files in a private bucket served by short-lived signed URLs; contract templates with merge fields; e-sign on the public page (typed or drawn signature with timestamp, IP address and SHA-256 hash of the signed document). This is an ordinary electronic signature under the ECT Act, not an "advanced electronic signature"; the UI says so.

### 6.12 Customer portal
`/portal/[token]`: a client sees all their invoices, quotes and contracts, can pay and sign. Link is emailed on request; token is revocable.

## 7. Cross-cutting features

- **Command palette (Ctrl/Cmd+K) and global search** across clients, invoices, quotes, tasks, products, using Postgres full-text search.
- **Quick add "+"**: floating button on mobile, header button on desktop; invoice, client, task or expense with the minimum fields.
- **Notifications centre** (in-app, Realtime) plus web push for: payment received, invoice viewed, quote accepted, booking made, low stock, task assigned, daily reminder.
- **Automation rules**: trigger → condition → action, from a fixed list. Triggers: invoice overdue N days, quote not accepted N days, stock below threshold, booking in N hours, task overdue. Actions: send reminder, notify me, create task. Evaluated by a scheduled job; every run is logged.
- **Outbox**: every email, push and reminder is a row with an idempotency key; a worker sends and records the result. Retries cannot duplicate.
- **Audit log**: append-only table written by database triggers on financial and membership tables.
- **Undo**: destructive actions soft-delete, show a 6-second undo toast, and are purged after 30 days.
- **Keyboard shortcuts**, dark mode, reduced-motion support.
- **Every screen** has a loading skeleton, an empty state with one clear next action, an error state with retry, and success feedback.

## 8. Growth loop, plans, AI

### 8.1 Rewards
- XP for meaningful actions (send invoice 20, get paid 50, log expense 5, complete task 5, finish quest step 30). Levels are cosmetic.
- Streak: a day counts when the user does at least one XP action. One automatic "freeze" per week so a missed day does not wipe a streak.
- Confetti once each for: first invoice sent, first payment received, quest complete, revenue goal hit. Disabled under reduced-motion.

### 8.2 Plans and billing
- **Free:** 1 workspace, unlimited clients and users, 10 sent invoices or quotes per month, 200 MB storage, 20 AI requests per month, "Sent with Ledgerly" footer on documents.
- **Pro:** unlimited documents, 10 GB storage, 300 AI requests per month, automations, custom branding, customer portal, multiple workspaces. Proposed R199 per workspace per month, flat, unlimited users. Price lives in config; owner confirms before Phase 7.
- Limits are enforced in the database (a check in the send function), not just the UI. Hitting a limit never blocks viewing or exporting data.
- Paid checkout uses PayFast subscriptions with the same ITN verification, on Ledgerly's own merchant account. Built in Phase 7; until then every workspace is on Free with limits enforced.

### 8.3 AI
- All AI calls go through one server-side interface (`src/lib/ai`) with two operations: `chat(messages, tools)` and `extractReceipt(image)`. The provider is a config choice, not a code dependency.
- Provider: a free-tier API. Candidates are Google Gemini and Groq. The choice is made at the start of Phase 6 by checking current free-tier limits and, critically, data terms: customer financial data must not go to a tier whose terms allow training on prompts. If no free tier meets that bar, AI features ship behind an explicit per-workspace opt-in that states where data goes.
- The assistant answers from the workspace's own data by calling a fixed set of read-only queries that run as the signed-in user, so RLS applies. It can draft a reminder or summary; sending always requires a tap.
- Per-workspace monthly caps and a global daily cap protect the free quota. When the cap is hit or the provider is down, the UI says so and everything else keeps working.

## 9. Setup quest

Generated from onboarding answers; 4–6 steps, for example: Add your business details and logo → Add your first client → Send your first invoice → Connect Yoco or PayFast (or add bank details for EFT) → Log an expense → Invite your team. Each step deep-links to the action and completes automatically when the action happens.

## 10. Data model

All tables have `id uuid`, `workspace_id`, `created_at`, `updated_at`, and where users delete things, `deleted_at`. Money columns are `bigint` cents.

| Area | Tables |
|---|---|
| Tenancy | `workspaces`, `memberships`, `invites`, `workspace_modules`, `workspace_settings`, `profiles` (per user, no workspace_id; RLS by user id) |
| Onboarding and rewards | `onboarding_answers`, `quest_steps`, `xp_events`, `streaks`, `goals` |
| CRM | `companies`, `contacts`, `tags`, `contact_tags`, `notes`, `activities`, `pipeline_stages`, `deals` |
| Sales | `documents_sales` (type: invoice, quote, credit note), `document_lines`, `document_sequences`, `recurring_schedules`, `public_links` |
| Payments | `payment_connections` (Vault secret ids only), `payments`, `payment_events` |
| Expenses | `expenses`, `expense_categories`, `receipts`, `bank_imports`, `bank_lines`, `recurring_costs` |
| Work | `projects`, `tasks`, `time_entries` |
| Inventory | `products`, `stock_movements`, `suppliers`, `purchase_orders`, `purchase_order_lines` |
| Bookings | `services`, `availability_rules`, `bookings` |
| Documents | `folders`, `files`, `contract_templates`, `contracts`, `signatures` |
| Platform | `notifications`, `push_subscriptions`, `automation_rules`, `automation_runs`, `outbox`, `audit_log`, `ai_usage`, `subscriptions`, `rate_limits`, `consents` |

Public access never queries tables directly: `/p`, `/book` and `/portal` call narrowly scoped SQL functions that take a token, return only the fields that page shows, and are rate-limited per IP.

## 11. Screens

- **Marketing:** landing, pricing, privacy policy, terms, POPIA notice (PAIA/information officer contact), cookie banner, 404, 500.
- **Onboarding and auth:** `/start` (9 steps), building screen, `/login`, code entry, auth error.
- **App shell:** bottom tab bar on mobile (Home, Money, Clients, Work, More), collapsible sidebar on desktop, workspace switcher, quick add, command palette, notifications panel, assistant panel.
- **Per module:** list, detail, create/edit sheet for — clients, companies, pipeline, invoices, quotes, credit notes, recurring, expenses, bank import, projects, task board/list/calendar, time, products, suppliers, purchase orders, bookings calendar, services, availability, files, contracts, reports (4).
- **Settings:** business details, branding, invoice defaults and VAT, payments, modules, team, automations, notifications, plan and billing, data export, delete account/workspace, audit log.
- **Public:** document page, booking page, customer portal, payment result.

## 12. Security, compliance and launch

- RLS on every table; cross-tenant and role tests in `supabase/tests`, run in CI against a Supabase branch (no Docker on the dev machine).
- Security headers and a nonce-based CSP; no `dangerouslySetInnerHTML`; SameSite cookies and origin checks on server actions; rate limits on auth, public pages and webhooks.
- Private storage buckets; signed URLs of 60 seconds for downloads.
- Secrets only in Vercel and Supabase environment settings; `.env.example` committed; a secret scan in CI.
- Supabase security advisor run at the end of every phase; all warnings fixed.
- POPIA: privacy policy, terms, cookie consent, purpose notice at sign-up, full data export (ZIP of CSVs and files), one-click account and workspace deletion with a 7-day grace period, information officer contact, breach-response document in `docs/`.
- Operations: Sentry, an uptime check, structured logs, documented backup and one performed restore test.
- SEO: metadata, Open Graph images, sitemap, robots, schema markup on marketing pages. App and public document pages are `noindex`.
- Final deliverable: `docs/launch-report.md` with pass/fail per checklist item. Items needing the owner (domain, DNS records, company details, legal review of policy text) are listed as owner actions, not marked passed.

**Limit to state plainly:** the privacy policy and terms will be solid drafts based on POPIA requirements, not legal advice. They should be reviewed by a South African attorney before paid launch.

## 13. Testing

- Unit (Vitest): money and VAT maths, numbering, recurrence, forecast, webhook signature verification, Zod schemas.
- Database: RLS tests for every table (member can, non-member cannot, role limits hold).
- End-to-end (Playwright): landing → onboarding → sign-in → first invoice sent; public invoice pay flow against processor sandboxes; quote accept and sign.
- CI gate on every commit: lint, typecheck, unit tests. Phase is not called done until these pass.

## 14. Out of scope for v1

Live bank feeds, multi-currency, offline writes, the Capacitor build, double-entry ledger, payroll, WhatsApp Business API, Google Calendar sync, inventory variants and locations, native app store listings.
