# Phase 4 — Expenses, bank import, projects and tasks, time, bookings

Expands Phase 4 of `docs/plan.md`. Spec: `docs/spec.md` §3 (roles), §6.5, §6.6, §6.8, §7 (outbox, quick add), §8.1 (XP), §9 (quest), §10 (data model). Global Constraints and Review Focus of the master plan apply.

## External facts (checked 2026-11-12)

- **SA bank CSV exports are not standardised and not officially documented.** Third-party import tools report: FNB and Standard Bank `DD/MM/YYYY`; Nedbank `YYYY-MM-DD`; Capitec `YYYY/MM/DD` (Capitec often has no native CSV); Absa reported as both `DD/MM/YYYY` and `YYYYMMDD`, with an empty first line and an opening-balance row before transactions. Nedbank exports carry "BROUGHT FORWARD"/"CARRIED FORWARD" rows. Sources were vendor docs, not the banks.
  → **Ruling:** no per-bank templates. The importer finds the header row itself, guesses the mapping, and the owner confirms it (same wizard pattern as the client CSV import). Supported: one signed amount column *or* separate debit/credit columns; dates in the five formats above plus `12 Jan 2026`; amounts `R 1 234,56`, `1,234.56`, `-450.00`, `450.00 Dr`/`Cr`. Summary rows (brought/carried forward, opening/closing balance) and rows without a valid date are skipped and counted, never silently dropped.
- **.ics** follows RFC 5545: `VCALENDAR`/`VEVENT`, CRLF line endings, lines folded at 75 octets, `DTSTART`/`DTEND` in UTC (`…Z`), `UID`, `DTSTAMP`, text escaping of `\ ; ,` and newlines.

## Design rulings

- **Where things live.** Money tab gains tabs: Invoices · Expenses · Bank. Work tab: Projects · Tasks · Bookings. Quick add gains "Log expense" and "Add task".
- **Roles.** Expenses, bank lines: members read (accountant read-only); owner/admin/staff write; staff cannot delete bank imports. Projects, tasks, time: all members read; owner/admin/staff write; accountant read-only. Services/availability (booking setup): owner/admin only. Bookings: owner/admin/staff manage.
- **Receipts.** Private bucket `receipts`, path `<workspace_id>/<expense_id>/<uuid>.<ext>`, JPG/PNG/WebP/PDF ≤ 5 MB, folder-based RLS with the uuid regex guard (the review noted the payment-proofs read policy lacked it — the new policy has it). Viewing uses a 60-second signed URL. OCR is Phase 6.
- **VAT on expenses.** `amount_cents` (incl. VAT) and `vat_cents` (claimable input VAT, default 0; a "includes 15% VAT" toggle computes `round(amount × 15/115)` half away from zero). Reports use these in Phase 5.
- **Recurring costs.** `recurring_costs(cadence weekly|monthly|yearly, next_date)`; a daily pg_cron job inserts due expenses with idempotency key `recurring:<id>:<date>` and advances `next_date` (month-end clamps: 31 Jan → 28/29 Feb → 31 Mar keeps the anchor day).
- **Bank import duplicates.** Each line's fingerprint = sha256(date | amount_cents | normalised description | occurrence index within that file for identical triples). Unique `(workspace_id, fingerprint)`; re-importing the same file adds nothing, two genuinely identical same-day lines in one file both survive.
- **Matching.** Credits are suggested against open invoices: exact amount owed, then invoice number found in the description. Accepting a match records a payment (method `eft`, reference = bank description) through `record_manual_payment`, with request id = bank line id so it cannot be applied twice. Debits can be turned into expenses in one tap.
- **Tasks.** `status todo|doing|done`, `priority low|normal|high`, `parent_id` for one level of subtasks, `assignee_id` must be a member (checked in a trigger). One `listTasks` query feeds list, kanban and calendar. Completing a task awards 5 XP once per task.
- **Time.** `time_entries(started_at, ended_at null while running)`, at most one running timer per user per workspace (partial unique index). `invoiceFromTime(projectId, entryIds)` = SQL `invoice_time_entries` creating one draft invoice with one line per entry (hours to 2 decimals × project rate), marking entries with `invoice_id` under a row lock; already-invoiced entries are refused. Deleting the draft frees the entries (`on delete set null (invoice_id)`).
- **Bookings.** `services(duration_min, buffer_min, price_cents)`, `availability_rules(weekday 0–6, start_time, end_time)` in SAST, `bookings(tstzrange during)` with an exclusion constraint (`btree_gist`) on `(workspace_id, during with &&)` where status = confirmed, so two simultaneous bookings for one slot cannot both succeed. `get_available_slots(slug, date)` and `create_booking(...)` are anon-callable SECURITY DEFINER functions behind `/book/[slug]`, rate-limited per IP in the app. Confirmation and 24-hour reminder emails go through the outbox; `/book/[slug]/[token].ics` downloads the event. Slot times are always shown in SAST.

## Tasks

1. **4.1 Expenses** — 0020 expenses, categories, receipts bucket, recurring costs + cron; Money › Expenses list, quick add, edit, receipt view; quest `first_expense`, 5 XP.
2. **4.2 Bank CSV import** — 0021 bank_imports/bank_lines; `parseBankCsv`, `detectDuplicates`; wizard; match-to-invoice and debit-to-expense.
3. **4.3 Projects and tasks** — 0022 projects/tasks; Work › Projects, Tasks (list, board, calendar); quest `first_task`.
4. **4.4 Time tracking** — 0023 time_entries; timer that survives reload; manual entries; billable hours → draft invoice.
5. **4.5 Bookings** — 0024 services, availability, bookings; settings; public `/book/[slug]`; outbox confirmation and reminder; .ics; quest `booking_page`.

Each task: SQL test file first (RLS isolation, roles, the plan's named tests), unit tests for pure helpers, one e2e journey, commit.

## As built (differences from the plan above, after the Phase 4 review)

- **Bank statements** are visible to owner, admin and accountant, and written by owner and admin only. Staff do not see them (RLS, the definer functions and the page all enforce it). Matched or logged lines can be undone (`reset_bank_line`) once the payment is removed or the expense archived; an import nobody has used can be deleted (`delete_bank_import`).
- **Bookings:** `create_booking` is callable only by the server (service role), behind an IP rate limit, so the public key can never trigger an email. Weekdays are ISO 1–7. A booking stores `starts_at`, `ends_at` and `blocked_until` (end plus gap); an exclusion constraint on `tstzrange(starts_at, blocked_until)` per workspace stops overlaps. Horizons: the public page offers 14 days, the database allows 60, the team list shows 60.
- **Time:** an entry bills as hours to 2 decimals, minimum 0.01 h (entries under 18 s). A timer left running is capped at 24 hours by both start and stop. Tasks assigned to someone who leaves are unassigned.
- **Expenses:** the VAT toggle appears (and defaults on) only for VAT-registered businesses. Projects archive with a 6-second undo and an Archived list with Restore.
- **Not in Phase 4** (deferred, logged in the ledger as minors): a calendar view of bookings (the team sees a day-grouped list), owner notification when a client books (Phase 6), cancelled-booking emails to the client (Phase 6), OCR (Phase 6), idempotency for manual time entries, rounding hours to 4 decimals instead of 2.
