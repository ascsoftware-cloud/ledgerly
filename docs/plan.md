# Ledgerly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Ledgerly v1, a mobile-first PWA business manager for South African small businesses, in seven phases, each ending in working, tested, committed software.

**Architecture:** Next.js App Router on Vercel talks to Supabase as the signed-in user; Postgres row-level security is the security boundary. The service-role key is confined to webhook handlers, the scheduled worker and account deletion. Each product module lives in `src/features/<module>` with its own Zod schemas, queries and server actions.

**Tech Stack:** Next.js (App Router), TypeScript strict, Tailwind, shadcn/ui, Framer Motion, Supabase (Postgres, Auth, Storage, Realtime, Edge Functions, pg_cron, Vault), Zod, Vitest, Playwright, Resend, Yoco, PayFast, Sentry. Use the latest stable versions at scaffold time and pin them in the lockfile; read each library's current docs before first use rather than relying on memory.

**Spec:** `docs/spec.md` (research: `docs/research.md`)

**How this plan is layered.** The spec covers about fifteen subsystems, so one step-level plan for everything would be a transcript of the program. This document is the master plan: Phase 1 is written to step level; Phases 2–7 are written to task level (files, interfaces, tests, exit check). At the start of each later phase, its tasks are expanded to steps in `docs/plans/phase-N.md`, because they depend on real code from earlier phases and on external facts checked at that time (PayFast's official verification rules, AI free-tier terms).

## Global Constraints

- Locale `en-ZA`, currency `ZAR`, timezone `Africa/Johannesburg`. "Today", "overdue" and "this month" are computed in SAST, never UTC.
- Money is integer cents (`bigint` in SQL, `number` in TS); never floats. VAT rate is 15% or 0% per line.
- Every table: `workspace_id` (indexed), RLS enabled, policies written with `app.is_member(workspace_id)` and `app.has_role(workspace_id, roles[])`. A table is not done until its RLS test exists and passes.
- Roles: `owner`, `admin`, `staff`, `accountant` (lowercase in the database).
- Every server action and route handler parses input with Zod first. No string-built SQL. No `dangerouslySetInnerHTML`.
- Service-role key only in `src/lib/supabase/admin.ts`, imported only by `src/app/api/webhooks/**`, `supabase/functions/**` and the deletion action. A lint rule enforces the import boundary.
- Auth UI offers only Google and email. No password field exists anywhere.
- Payment processors: Yoco and PayFast only.
- Touch targets ≥ 44px; WCAG AA contrast; visible focus rings; `prefers-reduced-motion` disables slides, confetti and haptics. Motion 150–250ms.
- Every screen ships with a skeleton, an empty state with one next action, an error state with retry, and success feedback.
- Every migration has a down script in `supabase/migrations/down/`.
- Phase gate: `npm run check` (lint + typecheck + unit tests) passes, and from Phase 2 the RLS suite and the Supabase security advisor are clean, before the phase commit.
- No secrets in the repo. `.env.example` lists every variable.

## Review Focus

The inputs most likely to bite a real user that the spec implies but does not spell out. Each has a test in the task named.

1. **Magic link opened on a different device** — onboarding answers are in localStorage on the first device, so they are missing at sign-in. Expected: workspace is provisioned with sensible defaults and the user is offered the questions again; nothing crashes. *(Task 2.4)*
2. **Duplicate delivery** — a replayed webhook, or a double tap on "Send". Expected: one payment, one invoice number, one email. *(Tasks 3.3, 3.6, 6.1)*
3. **South African number and date formats in CSV and typed amounts** — `R 1 234,56`, `1,234.56`, `31/01/2026`, semicolon delimiters. Expected: parsed correctly or rejected with the row shown; never silently wrong. *(Tasks 1.3, 3.1, 4.2)*
4. **Cents that do not add up** — per-line VAT, discounts and deposits. Expected: document total always equals the sum of its displayed lines, and deposit plus balance equals total. *(Task 1.3)*
5. **Access removed mid-session** — a member is removed or downgraded while signed in, or opens a URL for a workspace they do not belong to. Expected: next request is refused with a 404, not an error page or stale data. *(Task 2.2)*

---

## Phase 1 — Scaffold and design system

Needs from owner: nothing.

### Task 1.1: Project scaffold and quality gate

**Files:**
- Create: Next.js app at repo root (`src/` directory, App Router, TypeScript, Tailwind, ESLint), `vitest.config.ts`, `playwright.config.ts`, `.prettierrc`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`, `README.md`
- Test: `src/lib/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `e2e` (`playwright test`), `check` (`lint && typecheck && test`). Path alias `@/*` → `src/*`.

- [ ] **Step 1:** Scaffold with `create-next-app` into the existing repo (keep `docs/`). Set `"strict": true` and `"noUncheckedIndexedAccess": true` in `tsconfig.json`.
- [ ] **Step 2:** Add Vitest, Playwright, Prettier, Zod, Framer Motion. Initialise shadcn/ui with CSS variables enabled.
- [ ] **Step 3:** Write `src/lib/smoke.test.ts` asserting `1 + 1 === 2`; add the scripts above.
- [ ] **Step 4:** Run `npm run check`. Expected: lint clean, typecheck clean, 1 test passed.
- [ ] **Step 5:** Run `npm run build`. Expected: build succeeds.
- [ ] **Step 6:** Write `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `AI_PROVIDER`, `AI_API_KEY`, `SENTRY_DSN` (all empty). Write `ci.yml` running `npm ci && npm run check && npm run build`.
- [ ] **Step 7:** Commit `chore: scaffold Next.js app with quality gate`.

### Task 1.2: Design tokens and theming

**Files:**
- Create: `src/styles/tokens.css`, `src/lib/theme/accents.ts`, `src/lib/theme/theme-provider.tsx`, `src/app/styleguide/page.tsx`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`
- Test: `src/lib/theme/accents.test.ts`

**Interfaces:**
- Produces: `type Accent = 'emerald' | 'indigo' | 'coral' | 'amber' | 'violet' | 'sky'`; `ACCENTS: Record<Accent, { label: string; light: string; dark: string; onAccent: string }>`; `<ThemeProvider accent mode>`; `useTheme(): { accent: Accent; mode: 'light' | 'dark' | 'system'; setAccent; setMode }`. The accent is applied as `data-accent` and the mode as `data-theme` on `<html>`.
- Tokens (CSS variables): colour (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--on-accent`, `--success`, `--warning`, `--danger`), type scale (12/14/16/18/20/24/30/36), spacing on a 4px base, radius (`8/12/16/24/full`), three shadows, motion (`--dur-fast: 150ms`, `--dur: 200ms`, `--dur-slow: 250ms`).

- [ ] **Step 1:** Write `accents.test.ts`: for every accent in both modes, the WCAG contrast ratio of `onAccent` on the accent colour is ≥ 4.5, and of `--text` on `--bg` is ≥ 4.5 (compute ratio in the test from hex values).
- [ ] **Step 2:** Run it. Expected: FAIL, `ACCENTS` not defined.
- [ ] **Step 3:** Implement `accents.ts` and `tokens.css`; map shadcn's variables onto the tokens in `globals.css`. Adjust any accent shade until the test passes.
- [ ] **Step 4:** Implement `ThemeProvider` (persists to localStorage, honours `prefers-color-scheme`, no flash on load via an inline script with a nonce placeholder).
- [ ] **Step 5:** Build `/styleguide` showing tokens, type scale, buttons, inputs, cards, in both modes with an accent switcher.
- [ ] **Step 6:** Run `npm run check`. Expected: PASS. Open `/styleguide` in the browser and confirm both modes and all six accents render.
- [ ] **Step 7:** Commit `feat: design tokens, accents and theme provider`.

### Task 1.3: Money and date core

**Files:**
- Create: `src/lib/money.ts`, `src/lib/dates.ts`
- Test: `src/lib/money.test.ts`, `src/lib/dates.test.ts`

**Interfaces:**
- Produces:
  - `parseAmount(input: string): number | null` — cents, or `null` if not a number.
  - `formatMoney(cents: number, currency?: 'ZAR'): string`
  - `type LineInput = { quantity: number; unitCents: number; discountPct: number; vatRate: 0 | 15 }`
  - `calcLine(l: LineInput): { netCents: number; vatCents: number; grossCents: number }`
  - `calcTotals(lines: LineInput[], deposit?: { type: 'pct' | 'amount'; value: number }): { subtotalCents; vatCents; totalCents; depositCents; balanceCents }`
  - `todaySAST(now?: Date): string` (`YYYY-MM-DD`), `isOverdue(dueDate: string, now?: Date): boolean`, `parseDateZA(input: string): string | null`, `formatDate(iso: string): string`

- [ ] **Step 1:** Write `money.test.ts`:
  - `parseAmount('R 1 234,56') === 123456`; `'1,234.56'` → `123456`; `'1234'` → `123400`; `'12,5'` → `1250`; `'abc'` → `null`; `''` → `null`; `'-50'` → `-5000`.
  - `formatMoney(123456)` equals `'R 1 234,56'` after normalising non-breaking spaces.
  - `calcLine({quantity: 3, unitCents: 3333, discountPct: 0, vatRate: 15})` → net `9999`, vat `1500`, gross `11499`.
  - `calcTotals` over three lines: `totalCents === sum of grossCents` and `depositCents + balanceCents === totalCents` for a 50% deposit on an odd total.
  - Quantity `0.5` and discount `12.5` round half-up to whole cents per line.
- [ ] **Step 2:** Write `dates.test.ts`:
  - `todaySAST(new Date('2026-01-31T22:30:00Z')) === '2026-02-01'`.
  - `isOverdue('2026-02-01', new Date('2026-02-01T21:59:00Z'))` is `false`; at `22:00:00Z` it is `true`.
  - `parseDateZA('31/01/2026') === '2026-01-31'`; `'2026-01-31'` passes through; `'01/31/2026'` → `null`; `'31-01-26'` → `'2026-01-31'`.
- [ ] **Step 3:** Run `npm test`. Expected: FAIL, modules not found.
- [ ] **Step 4:** Implement both modules. VAT is calculated per line on the discounted net and rounded per line; totals are sums of line results, never recomputed from the subtotal.
- [ ] **Step 5:** Run `npm test`. Expected: all PASS.
- [ ] **Step 6:** Commit `feat: money and SAST date helpers`.

### Task 1.4: UI primitives and app shell

**Files:**
- Create: `src/components/ui/*` (shadcn: button, card, input, sheet, dialog, dropdown-menu, tabs, toast, skeleton, badge, command), `src/components/states/{empty-state,error-state,page-skeleton}.tsx`, `src/components/shell/{app-shell,bottom-tabs,sidebar}.tsx`, `src/app/(app)/demo/page.tsx`
- Test: `e2e/shell.spec.ts`

**Interfaces:**
- Produces: `<EmptyState icon title body action={{ label, href | onClick }} />`, `<ErrorState title onRetry />`, `<PageSkeleton variant="list" | "detail" | "dashboard" />`, `<AppShell nav={NavItem[]}>` where `type NavItem = { key: string; label: string; href: string; icon: LucideIcon; module?: string }`. Mobile (< 768px) renders `BottomTabs` with five items: Home, Money, Clients, Work, More. Desktop renders a collapsible `Sidebar`.

- [ ] **Step 1:** Write `e2e/shell.spec.ts`: at 390×844 the bottom tab bar is visible with five tabs and the sidebar is not; at 1280×800 the sidebar is visible and collapses on toggle; every tab is reachable by keyboard and shows a focus ring; each tab's bounding box is ≥ 44px high.
- [ ] **Step 2:** Run `npm run e2e`. Expected: FAIL, route not found.
- [ ] **Step 3:** Add the shadcn components, build the three state components and the shell, and mount them on `/demo` with placeholder nav.
- [ ] **Step 4:** Run `npm run e2e` and `npm run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: UI primitives, state components and responsive shell`.

### Task 1.5: Security headers, landing shell, error pages

**Files:**
- Create: `src/lib/security/csp.ts`, the request middleware file (named per the installed Next.js version's convention), `src/app/(marketing)/page.tsx`, `src/app/(marketing)/layout.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`
- Test: `src/lib/security/csp.test.ts`, `e2e/landing.spec.ts`

**Interfaces:**
- Produces: `buildCsp(nonce: string, opts: { supabaseUrl: string; dev: boolean }): string`. Middleware sets `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` and passes the nonce to the layout.

- [ ] **Step 1:** Write `csp.test.ts`: output contains `default-src 'self'`, `script-src` with the nonce and no `'unsafe-inline'` when `dev` is false, `frame-ancestors 'none'`, and `connect-src` containing the Supabase URL.
- [ ] **Step 2:** Write `e2e/landing.spec.ts`: `/` returns 200 with one `<h1>`, a "Get started" link to `/start`, and the six response headers above; `/nope` shows the 404 page with a link home.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement. Landing content: hero, three benefit cards drawn from `docs/research.md` section 5, pricing teaser, footer with legal link placeholders pointing to routes built in Phase 7.
- [ ] **Step 5:** Run `npm run check && npm run e2e && npm run build`. Expected: all PASS.
- [ ] **Step 6:** Commit `feat: security headers, landing shell and error pages`. This is the Phase 1 commit.

**Phase 1 exit:** `npm run check`, `npm run e2e` and `npm run build` pass; `/`, `/styleguide` and `/demo` verified in the browser at mobile and desktop widths.

---

## Phase 2 — Auth, onboarding, provisioning

Needs from owner at start: Supabase project (new or existing), Google OAuth client, Resend account and sending domain. A numbered set-up checklist is written into `README.md` as the first task.

| Task | Deliverable | Key files | Produces | Tests |
|---|---|---|---|---|
| 2.1 Supabase wiring | Browser, server and admin clients; session refresh in middleware; owner checklist in README | `src/lib/supabase/{client,server,admin}.ts` | `createClient()`, `createServerClient()`, `createAdminClient()`; ESLint boundary rule for `admin.ts` | Lint fails on a forbidden import of `admin.ts` |
| 2.2 Tenancy schema | `workspaces`, `memberships`, `profiles`, `invites`, `workspace_modules`, `workspace_settings` with RLS | `supabase/migrations/*_tenancy.sql`, `supabase/tests/tenancy.test.ts` | SQL `app.is_member(uuid)`, `app.has_role(uuid, text[])`; TS `requireWorkspace(slug): Promise<{ workspace; role }>` (404 when not a member); RLS test helper `asUser(email)` | User A cannot select, insert, update or delete B's rows in each table; removed member is refused on next query; `requireWorkspace` 404s for a non-member |
| 2.3 Sign-in | `/login`, code entry, `/auth/callback`, `/auth/confirm`, rate limits | `src/app/(auth)/**`, `src/features/auth/{actions,schema}.ts`, `src/lib/rate-limit.ts`, `rate_limits` table | `rateLimit(key: string, max: number, windowSec: number): Promise<boolean>`; actions `signInWithGoogle()`, `requestEmailCode(email)`, `verifyEmailCode(email, code)` | 4th email request in 10 minutes is refused; no password input exists in the DOM; invalid email rejected by Zod |
| 2.4 Onboarding flow | `/start`, nine screens, Miko reactions, progress, back, sound/haptic toggles, live theme preview, localStorage persistence | `src/features/onboarding/{questions.ts,store.ts,schema.ts,components/*}`, `src/app/(onboarding)/start/page.tsx` | `OnboardingAnswers` Zod schema (versioned `v: 1`); `loadAnswers(): OnboardingAnswers | null` returning `null` for missing, corrupt or old-version data | Refresh mid-flow resumes at the same question; corrupt localStorage yields `null`; e2e completes all eight questions by tapping only |
| 2.5 Provisioning | `provision_workspace(answers jsonb)` transaction; building screen with real step progress; rewards and quest tables | `supabase/migrations/*_provisioning.sql`, `src/features/onboarding/provision.ts`, tables `onboarding_answers`, `quest_steps`, `xp_events`, `streaks`, `goals` | SQL `provision_workspace(jsonb) returns uuid` (idempotent per user); TS `awardXp(workspaceId, event)`; quest auto-completion trigger | Each Q4 choice enables the right module; calling twice returns the same workspace; `null` answers provision defaults and flag "finish set-up" |
| 2.6 Dashboard v0 | App shell on real nav from enabled modules, workspace switcher, setup quest card, streak, goal ring, empty-state cards | `src/app/(app)/[ws]/page.tsx`, `src/features/dashboard/*` | `getEnabledNav(workspaceId): NavItem[]` | e2e: landing → onboarding → sign-in (test OTP) → dashboard shows quest matching answers |

**Phase 2 exit:** phase gate plus RLS suite and security advisor clean; the e2e above passes against a Supabase branch.

## Phase 3 — Clients, invoices, quotes, payments

Needs from owner: Yoco and PayFast sandbox credentials. First step: read PayFast's official ITN documentation and record the verified rules in `docs/plans/phase-3.md`.

| Task | Deliverable | Key files | Produces | Tests |
|---|---|---|---|---|
| 3.1 Clients | Contacts, companies, tags, notes, timeline, CSV import with mapping and preview | `src/features/clients/*`, migration `*_crm.sql` | `logActivity(workspaceId, { subject, kind, refId })`; `parseCsv(text): { headers; rows }` | RLS per table; CSV with semicolons, quoted commas, BOM and `31/01/2026` dates imports correctly; bad rows are shown, not dropped |
| 3.2 Pipeline | Stages and deals kanban with drag and keyboard move | `src/features/pipeline/*` | — | Staff can move deals; accountant cannot write |
| 3.3 Sales documents | Invoice/quote/credit-note editor, line items, VAT toggle, deposits, statuses, gapless numbering, quote → invoice | `src/features/sales/*`, migration `*_sales.sql` | SQL `send_document(id uuid) returns text` (assigns number atomically, enforces Free-plan limit, idempotent); TS `convertQuoteToInvoice(id)` | 20 concurrent sends yield 20 consecutive numbers; double send returns the same number; totals match `calcTotals`; 11th send on Free is refused |
| 3.4 PDF and public page | Three templates, `/p/[token]`, view tracking, quote accept and sign | `src/features/sales/pdf/*`, `src/app/p/[token]/*`, `public_links`, `signatures` | SQL `get_public_document(token text)`; `accept_quote(token, signature)` | Wrong token → 404; function returns no fields beyond the page's; rate limit holds; signature stores hash, time, IP |
| 3.5 Sending | Outbox table and worker (edge function + pg_cron), email via Resend, WhatsApp share link | `supabase/functions/outbox-worker`, `src/lib/outbox.ts`, `src/lib/whatsapp.ts` | `enqueue(workspaceId, { kind, to, template, data, idempotencyKey })`; `whatsappLink(phone, text)` | Same idempotency key enqueued twice sends once; failed send retries with backoff and stops after 5; SA numbers `082…` normalise to `2782…` |
| 3.6 Payments | Connections in Vault, Yoco checkout, PayFast redirect, both webhooks, EFT mark-as-paid with proof, confetti on first payment | `src/lib/payments/{yoco,payfast,types}.ts`, `src/app/api/webhooks/{yoco,payfast}/route.ts`, migration `*_payments.sql` | `interface PaymentProvider { createCheckout(doc, returnUrls): Promise<{ url }>; verifyWebhook(req): Promise<PaymentEvent | null> }`; SQL `apply_payment_event(provider, event_id, …)` | Yoco: valid signature accepted; tampered body, wrong secret, timestamp older than 3 minutes rejected. PayFast: per verified rules. Replayed event applies once; part-payment sets `part_paid`; overpayment is recorded and flagged |
| 3.7 Quick add and reminders | "+" sheet for invoice, client; invoice reminders before/on/after due | `src/components/quick-add/*`, `supabase/functions/reminders` | — | Invoice can be created and sent in ≤ 3 taps after a client exists; reminder not sent for paid or void invoices |

**Phase 3 exit:** Definition-of-done e2e — landing → onboarding → first invoice sent — runs in under 3 minutes of scripted interaction; sandbox payment marks an invoice paid.

## Phase 4 — Expenses, projects and tasks, bookings

| Task | Deliverable | Produces | Tests |
|---|---|---|---|
| 4.1 Expenses | Quick add, categories, receipt upload to private bucket with signed URLs, recurring costs | `getSignedUrl(path, 60)` | Other workspace cannot fetch the object; URL expires |
| 4.2 Bank CSV import | Upload, column mapping, duplicate detection, match-to-invoice suggestions | `detectDuplicates(lines, existing)` | Re-importing the same file adds nothing; `R 1 234,56` and negative debits parse correctly |
| 4.3 Projects and tasks | Projects, tasks, subtasks, kanban/list/calendar over one query | `listTasks(workspaceId, filter)` | Views show identical sets; staff sees only permitted actions |
| 4.4 Time tracking | Timer, manual entries, billable hours → draft invoice | `invoiceFromTime(projectId, entryIds)` | Entries invoiced once only; timer survives reload |
| 4.5 Bookings | Services, availability, buffers, `/book/[slug]`, confirmations and reminders through the outbox, .ics | SQL `get_available_slots(slug, date)`, `create_booking(...)` | Two simultaneous bookings for one slot: exactly one succeeds; slots shown in SAST |

## Phase 5 — Inventory, team, reports, documents

| Task | Deliverable | Produces | Tests |
|---|---|---|---|
| 5.1 Inventory | Products, `stock_movements`, low-stock alerts, suppliers, purchase orders | SQL trigger adjusting stock on invoice send and void | Stock equals sum of movements; voiding restores stock; concurrent sales cannot both take the last unit without a warning |
| 5.2 Team | Invites by email, role change, removal, activity log | `inviteMember(workspaceId, email, role)` | Role matrix test: each role × each table × each verb matches spec section 3; last owner cannot be removed |
| 5.3 Reports | P&L, 90-day cash-flow forecast, aged debtors, VAT summary, CSV and PDF export | SQL views or functions per report | Fixture data set with hand-computed expected figures; staff is refused |
| 5.4 Documents | Folders, files, contract templates with merge fields, e-sign, customer portal | `renderTemplate(template, data)` (escapes values) | Merge field containing HTML is escaped; revoked portal token → 404 |

## Phase 6 — Automation, AI, notifications, PWA

First step: check Gemini and Groq free-tier limits and data-use terms; record the choice and reasoning in `docs/plans/phase-6.md`. Needs from owner: the chosen provider's free API key.

| Task | Deliverable | Produces | Tests |
|---|---|---|---|
| 6.1 Automations | Rule builder from fixed triggers and actions, scheduled evaluator, run log | `evaluateRules(now)` | A rule fires once per matching record, not once per run; disabled rule never fires |
| 6.2 Notifications | In-app centre over Realtime, web push, preferences | `notify(workspaceId, userId, { kind, title, href })` | User receives only own workspace's notifications; push subscription removed on 410 |
| 6.3 AI layer | Provider adapter, read-only tools run as the user, caps, assistant panel, receipt OCR, dashboard summary | `ai.chat(messages, tools)`, `ai.extractReceipt(image)` | With a mocked provider: tool calls cannot reach another workspace; cap reached returns a friendly refusal; provider error leaves the app usable; draft is never auto-sent |
| 6.4 Search and shortcuts | Command palette, global full-text search, keyboard shortcuts, undo toasts with soft delete | SQL `search(workspace_id, q)` | Results limited to the workspace; undo within 6 seconds restores the row |
| 6.5 PWA | Manifest, icons, splash screens, service worker with offline shell and read cache, install button | — | Lighthouse PWA installability; offline load shows cached shell and an offline banner |

## Phase 7 — Security pass, billing, launch

Needs from owner: Vercel connection, domain and DNS access, PayFast merchant account for subscriptions, Sentry project, company details for the footer, confirmation of Pro price.

| Task | Deliverable | Tests / evidence |
|---|---|---|
| 7.1 Billing | Free/Pro entitlements, PayFast subscription checkout and ITN, plan page | Subscription ITN activates Pro once; cancellation downgrades at period end without hiding data |
| 7.2 Security pass | Full RLS matrix re-run, advisor clean, CSP tightened, rate limits verified, secret scan, dependency audit, review of every service-role use | Advisor output and test run saved to `docs/launch-report.md` |
| 7.3 POPIA | Privacy policy, terms, cookie consent, purpose notice, data export ZIP, account and workspace deletion with 7-day grace, breach-response doc | Export contains every table's rows for the workspace and no one else's; deletion removes rows and storage objects |
| 7.4 Performance and SEO | Lighthouse ≥ 90 ×4 on landing, login and dashboard; metadata, OG images, sitemap, robots, schema markup | Lighthouse reports saved |
| 7.5 Operations | Sentry, uptime check, structured logs, backup and one performed restore test | Restore test written up with date and result |
| 7.6 Deploy | Vercel project, env vars, preview and production, custom domain, HTTPS, www redirect; README with set-up, env vars and deploy steps | Production smoke e2e |
| 7.7 Launch report | `docs/launch-report.md`: every brief section-6 item marked pass, fail or owner action, with evidence | — |

## Self-review notes

- **Spec coverage:** every section of `docs/spec.md` maps to a task: §3 → 2.2, 5.2; §4 → 2.3; §5 → 2.4, 2.5; §6.1 → 2.6 (completed as modules land); §6.2–6.12 → 3.1–5.4; §7 → 3.5, 3.7, 6.1, 6.2, 6.4; §8.1 → 2.5; §8.2 → 3.3 (limit), 7.1; §8.3 → 6.3; §9 → 2.5; §12 → 1.5, 7.2–7.7; §13 → every task's test column.
- **Known dependency:** RLS and e2e tests from Phase 2 onward need a Supabase project or branch, because Docker is not installed locally.
- **Not verifiable by me:** PWA install on a physical iPhone and Android phone (brief section 6). I can test in emulated browsers; the owner confirms on real devices, and the launch report will say which was done.
