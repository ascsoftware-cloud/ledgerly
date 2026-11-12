# Phase 2 step plan — auth, onboarding, provisioning

Expands Phase 2 of `docs/plan.md`. Spec: `docs/spec.md` sections 3, 4, 5, 8.1, 9. Global Constraints and Review Focus of the master plan apply.

**Order changed from the master plan:** onboarding (2.4) is built first because it needs no backend, so work proceeds while the Supabase project is being chosen.

## Task 2.4 — Onboarding flow (first)

**Files:** `src/features/onboarding/{schema.ts,questions.ts,store.ts,feedback.ts}`, `src/features/onboarding/components/{onboarding-flow.tsx,option-card.tsx,miko.tsx,theme-step.tsx,save-step.tsx}`, `src/app/(onboarding)/start/page.tsx`. Tests: `src/features/onboarding/{schema,store,questions}.test.ts`, `e2e/onboarding.spec.ts`.

**Produces:**
- `OnboardingAnswers` (Zod, `v: 1`): `business`, `team`, `headaches[]`, `manage[]`, `paid[]`, `revenue`, `accent`, `mode`, `dailyMinutes`.
- `loadDraft(storage): Draft` (never throws; empty draft for missing, corrupt or old-version data), `saveDraft(storage, draft)`, `clearDraft(storage)`, `loadAnswers(storage): OnboardingAnswers | null` (only when complete and valid).
- `QUESTIONS`: ordered definitions with `id`, `title`, `kind: "single" | "multi" | "theme"`, `options`, `react(value): string`.

- [ ] Unit tests first: schema accepts a full valid answer set and rejects unknown values, empty multi-selects and wrong `v`; store returns an empty draft for `null`, `"not json"`, `{"v":0}` and a throwing storage; `loadAnswers` is `null` until every question is answered; every option of every question has a non-empty reaction; question ids match the schema keys.
- [ ] Run: FAIL (modules missing). Implement. Run: PASS.
- [ ] e2e first: complete all eight questions by tapping only and reach the save screen showing both sign-in options; no text input exists on steps 1–8; Continue is disabled until something is chosen; Back returns to the previous answer still selected; reload mid-flow resumes on the same step; the vibe step changes `data-accent` and `data-theme` on `<html>` live; the whole flow works by keyboard alone.
- [ ] Run: FAIL (404). Implement components and page. Run: PASS. Browser check at 390px and 1280px.
- [ ] Commit `feat: tap-only onboarding flow`.

## Task 2.1 — Supabase wiring

**Files:** `src/lib/supabase/{client.ts,server.ts,admin.ts,env.ts}`, `src/proxy.ts` (session refresh only), `eslint.config.mjs` (import boundary), `README.md` (owner checklist), `.env.local` (not committed).

- [ ] Read the current `@supabase/ssr` guide for this Next.js version before writing.
- [ ] Test first: `env.test.ts` — missing or malformed URL/key gives a clear error naming the variable. Lint fixture proves importing `@/lib/supabase/admin` from `src/features/**` fails lint.
- [ ] Implement. Write the numbered owner checklist (Google OAuth client, redirect URLs, Resend SMTP with SPF/DKIM/DMARC, email template with both link and code).
- [ ] Commit.

## Task 2.2 — Tenancy schema

**Files:** `supabase/migrations/0001_tenancy.sql`, `supabase/migrations/down/0001_tenancy.sql`, `supabase/tests/{helpers.ts,tenancy.test.ts}`, `src/lib/workspace.ts`.

Tables: `profiles`, `workspaces` (slug unique, plan, theme), `memberships` (unique user+workspace, role check), `invites`, `workspace_modules`, `workspace_settings`. Schema `app` (not exposed) with `is_member`, `has_role` as `security definer`, `stable`, fixed `search_path`.

- [ ] RLS tests first (run against the project with two throwaway users created through the admin API): for every table, A cannot select/insert/update/delete B's rows; staff cannot change settings; accountant cannot write; removed member is refused; last owner cannot be removed or demoted; `requireWorkspace` 404s for a non-member.
- [ ] Run: FAIL. Apply migration. Run: PASS. Run security and performance advisors; fix every finding.
- [ ] Commit.

## Task 2.3 — Sign-in

**Files:** `src/app/(auth)/login/page.tsx`, `src/app/(auth)/auth/{callback,confirm}/route.ts`, `src/features/auth/{actions.ts,schema.ts}`, `src/lib/rate-limit.ts`, migration `0002_rate_limits.sql`.

- [ ] Tests first: Zod rejects bad emails; `rateLimit` allows 3 and refuses the 4th inside the window and allows again after it; e2e — login page has exactly one text input (email), no password field, both buttons present; `next` parameter only accepts same-site paths (open-redirect guard).
- [ ] Implement with PKCE. Commit.

## Task 2.5 — Provisioning

**Files:** migration `0003_provisioning.sql` (tables `onboarding_answers`, `quest_steps`, `xp_events`, `streaks`, `goals`; function `provision_workspace(jsonb)`), `src/features/onboarding/provision.ts`, building screen.

- [ ] DB tests first: each `manage` choice enables its module; business-type defaults apply; second call returns the same workspace id and creates nothing; `null` answers provision defaults and set `needs_setup`; quest steps match headaches and modules; revenue goal is the range midpoint.
- [ ] Implement. Advisors clean. Commit.

## Task 2.6 — Dashboard v0 and phase e2e

- [ ] `getEnabledNav`, workspace switcher, quest card, streak, goal ring, empty-state cards under `src/app/(app)/[ws]/`.
- [ ] e2e: landing → onboarding → sign-in (test user) → building screen → dashboard shows the quest that matches the answers; second device with no saved answers lands on a default workspace with "finish set-up".
- [ ] Phase gate: check, e2e, RLS suite, advisors. Commit.
