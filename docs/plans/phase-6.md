# Phase 6 — Automation, AI, notifications, search and PWA

Expands Phase 6 of `docs/plan.md`. Spec: `docs/spec.md` §7 (cross-cutting), §8.3 (AI), §10. Global Constraints and Review Focus of the master plan apply. Migrations continue at 0032.

## AI provider (checked 2026-11-13)

- **Google Gemini free tier — rejected.** Google's own terms: for unpaid quota "Google uses the content you submit" to improve its products, "human reviewers may read, annotate, and process your API input and output", and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Customer invoices and bank data fail the spec's bar. (Paid billing removes training, but that is not free.)
- **Groq free tier — chosen.** Groq's "Your Data" page says inference requests are not retained by default; its Terms say it does not permanently retain prompts or output; a Groq staff reply says it does no training or fine-tuning on customer data; Zero Data Retention can be switched on for any account in Data Controls. Secondary sources give free-tier limits of roughly 30 requests/minute and 14 400/day (varies by model, per organisation, and changes often); the limits page in the console is authoritative. Third-party summaries are inconsistent about 30-day abuse logging, so:
  → **Ruling:** use Groq, and the owner is told to switch on Zero Data Retention in the Groq console. AI is **off until an owner switches it on for the workspace** (Settings › AI), and that screen says where data goes (Groq, a US provider) and what is sent (only what the person asks about or scans). Cost if wrong: if Groq's terms change, the provider is one adapter file; AI is optional.
- The OpenAI-compatible endpoint (`https://api.groq.com/openai/v1/chat/completions`) is used. Model names are environment variables (`AI_MODEL`, `AI_VISION_MODEL`), not code, because Groq's catalogue changes. Defaults are best guesses and are **not verified without a key**; the owner confirms them in the console.
- Needs from owner: a free Groq API key as `GROQ_API_KEY`; VAPID keys for web push (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); `JOBS_SECRET` (already needed for email).

## Design rulings

**6.1 Automations (0032).** Rules are fixed: trigger + N days/hours + action. Allowed pairs: `invoice_overdue` and `quote_unaccepted` → send reminder (email the client, through the outbox), notify me, or create a task; `stock_below` and `booking_soon` → notify me or create a task; `task_overdue` → notify me. `app.evaluate_rules(now)` runs hourly in pg_cron; `automation_runs` has a unique `(rule_id, ref_id)` so a rule fires once per matching record, never once per run. Every run (fired or failed) is a log row. Disabled rules never fire. Owners and admins manage rules; everyone on the team can read the log.

**6.2 Notifications (0033).** `notifications` (per person), published over Realtime, with a bell and panel in the shell. Sources: payment received, invoice viewed, quote accepted, booking made, low stock, task assigned, automation "notify me", and a daily reminder at 08:00 SAST (overdue invoices and tasks due today). Preferences per kind (in-app, push). Web push: `push_subscriptions`, VAPID, delivered by a job that deletes a subscription on 404/410. Staff receive only operational kinds (no payments or low-stock money detail beyond what their role can read).

**6.3 AI (0034).** One interface `src/lib/ai` (`chat(messages, tools)`, `extractReceipt(image)`), Groq adapter, a mock for tests. Tools are a fixed, read-only list that run as the signed-in user, so row-level security applies, and none takes a workspace id from the model. The model's output is untrusted text: it can draft a reminder but nothing sends without a tap. Caps are enforced in the database (`ai_take`): 20 requests a month on Free, 300 on Pro (plan enforcement arrives in Phase 7, so all are Free), plus a global daily cap. Conversation is not stored. Provider error or cap reached shows a plain message and the rest of the app is unaffected.

**6.4 Search and shortcuts (0035).** `public.search(p_workspace, p_q)` is SECURITY INVOKER over clients, invoices and quotes, tasks, products and projects with Postgres full-text (prefix) matching, so RLS limits results. Command palette on Ctrl/Cmd+K; shortcuts `g` then `h/m/c/w/s` to go places, `n` then `i/c/t/e` to create, `?` for help. Undo toasts already exist wherever something can be archived; the e2e proves one.

**6.5 PWA.** Manifest, generated icons (192, 512, maskable, Apple), a service worker with an offline shell and a read cache of pages already visited (cleared on sign-out), an offline banner, an install button, and the push handler. Lighthouse itself is not run here; installability is checked by tests of the manifest, icons and worker registration.

## Tasks

1. **6.1 Automations** — migration, evaluator, Settings › Automations, run log.
2. **6.2 Notifications** — migration, triggers, bell and panel, preferences, push job.
3. **6.3 AI layer** — adapter, tools, caps, assistant panel, receipt scan, summary.
4. **6.4 Search and shortcuts** — `search`, palette, shortcuts.
5. **6.5 PWA** — manifest, icons, worker, offline, install.

Each task: SQL test first, unit tests for pure helpers, one e2e journey, commit. Full e2e runs in two halves at least five minutes apart (Supabase sign-in limit).

## As built (differences from the plan above)

- **Migrations:** 0032 notifications, 0033 automations (the plan numbered them the other way round), 0034 AI, 0035 search, 0036 an index the advisor asked for. Each has a down script; SQL tests: 35, 38, 23 and 20 checks.
- **Notifications:** a bell with live updates (Realtime, with the session token set on the socket), an inbox page, per-kind preferences, and web push (`web-push`, VAPID) delivered by a job that claims each push once and removes a subscription when the push service says 404/410. A daily 06:00 UTC (08:00 SAST) reminder lists overdue invoices and tasks due.
- **Automations:** fixed rules (trigger + N days/hours + action) checked hourly inside the database; a rule acts once for each matching record (claim row before the action); every firing or failure is in the run log. Plan gating (Pro) arrives with billing in Phase 7.
- **AI helper:** off until an owner or admin switches it on (Settings › AI, which says what is sent). Four read-only tools (overdue invoices, this month's money, recent expenses, low stock) fixed to one business and run as the signed-in person; only names and amounts reach the provider. Receipt photos fill the expense form for the person to check; nothing saves by itself. The monthly allowance (Free 20, Pro 300) and a service-wide daily cap are enforced in the database and a failed request is given back. A mock provider (`AI_PROVIDER=mock`) is used by the e2e tests. The "summary" is the suggested question "How is this month going?" rather than an automatic widget, so it never spends allowance unasked.
- **Search and shortcuts:** one search (clients, invoices, quotes, tasks, projects, products) as the signed-in person; every typed word must appear (case-insensitive, part of a word counts), so invoice numbers like `INV-0042` work. Ctrl/Cmd+K and a search button; `g` then `h/m/c/w/s`, `n` then `i/c/t/e`, `?`. Shortcuts never fire while typing. Undo toasts already existed (clients, expenses, work) and are covered by their own e2e tests.
- **PWA:** manifest, icons (192, 512, maskable, Apple 180; generated by `scripts/make-icons.mjs`), a service worker (offline page, read copies of up to 60 recently opened pages, built files kept, push), an offline banner, an install button (and an iPhone how-to) on More. Copies are cleared at sign-out; sign-in, portal, public and API pages are never kept. Found and fixed while testing: the proxy answered `/sw.js` with a 404 and treated `/offline` as a workspace, so the worker (and push, from 6.2) could not have registered in production.
- **Not verified here (needs the owner):** the Groq model names, tool-calling and limits (no key); real web push to a phone (VAPID keys); the install prompt on a phone and iPhone "Add to Home Screen"; Lighthouse; Resend email delivery; payment provider sandboxes.
- **Owner to do:** `AI_API_KEY` (Groq) and switch on Zero Data Retention in the Groq console, check `AI_MODEL` / `AI_VISION_MODEL`; `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; `RESEND_API_KEY`, `EMAIL_FROM`, `JOBS_SECRET` in Vercel.
