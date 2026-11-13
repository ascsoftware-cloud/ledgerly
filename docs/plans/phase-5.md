# Phase 5 — Inventory, team, reports, documents and portal

Expands Phase 5 of `docs/plan.md`. Spec: `docs/spec.md` §3 (roles), §6.7, §6.9, §6.10, §6.11, §6.12, §10. Global Constraints and Review Focus of the master plan apply. Migrations continue at 0027 (0050–0056 are the integrations branch).

## Design rulings

**5.1 Inventory (0027)**
- `products(sku, kind product|service, cost_cents, price_cents, vat_rate, track_stock, reorder_level, stock_qty, supplier_id)`. `stock_qty` is a cache kept by a trigger on `stock_movements`; the movements are the truth ("stock equals sum of movements" is tested).
- `stock_movements` is append-only (no update or delete grant). Reasons: `initial`, `adjustment`, `purchase`, `sale`, `void`. A unique index on `(line_id, reason)` for sale/void makes the invoice trigger idempotent.
- An invoice line may point at a product (`sales_document_lines.product_id`). Sending an invoice (status draft → sent) takes the stock; voiding a sent invoice puts it back. Quotes and credit notes do not move stock (a credit note does not return goods: the owner adjusts by hand).
- **Sales are never blocked by stock.** A business can sell what it has not yet counted. Concurrent sales serialise on the product row, so the cache stays exact; stock below zero shows an "Oversold" warning on the product and in the send toast. (Plan wording: "cannot both take the last unit without a warning".)
- Low stock = tracked product with `reorder_level > 0` and `stock_qty <= reorder_level`. Shown as a banner on the Stock page and as a count on the list; push and email alerts arrive with notifications in Phase 6.
- Purchase orders: draft → sent → received (or cancelled). Receiving is all-or-nothing and idempotent; it writes `purchase` movements and optionally updates the product cost. POs are numbered `PO-0001` per workspace through `document_sequences`. No email to suppliers yet (Phase 6): "Mark as sent" is manual and the PO page prints.
- Roles: owner/admin/staff write; accountant reads. Products archive (soft delete); movements are created only by definer functions (`adjust_stock`, the invoice trigger, `receive_purchase_order`).

**5.2 Team (0028)**
- `invites` already exists (token hash, role admin|staff|accountant, 7 days). New: `invite_member` (owner/admin; one pending invite per email; reissues a fresh token), `accept_invite` (the signed-in user's email must match the invite; this stops a forwarded link handing over access), `revoke_invite`. The invite email goes through the outbox (`team_invite`). The accept page is `/invite/[token]`; sign-in returns there.
- Roles change and removal use the existing RLS and `guard_membership` (only an owner changes an owner; last owner cannot go). New: `audit_log` (append-only, owner/admin read) written by triggers for member joined/removed/role changed, invite sent/revoked, invoice sent/voided, payment removed, stock adjusted, purchase order received. A member may leave a workspace themselves unless they are its last owner.
- The role matrix test attempts each verb as each role against the tables the spec names and compares with an expected table taken from spec §3.

**5.3 Reports (0029)**
- Owner, admin and accountant only; every report function raises "not found" for others (staff included). Dates are SAST.
- **Basis:** invoice basis (accrual). Income = invoices sent in the period (ex VAT) minus credit notes sent in the period; void and draft excluded. Costs = expenses in the period ex claimable VAT (`amount − vat`). VAT summary = output VAT on those invoices/credit notes minus input VAT on expenses. This matches the "invoice basis" most SA VAT vendors use; a "payments basis" switch is later.
- Aged debtors: open invoices (balance = total − paid − credited > 0), buckets Not due, 1–30, 31–60, 61–90, 90+ days past due as of today, with the per-client list.
- Cash-flow: 13 weekly buckets over 90 days. In = open invoice balances on their due date (overdue ones counted in the first week). Out = recurring costs by cadence. Recurring invoices do not exist yet, so they are not included (stated on the page). No bank balance is held, so the forecast shows net movement and a running total, not a balance.
- CSV and PDF export through route handlers; CSV cells that start with `= + - @` are neutralised.

**5.4 Documents and portal (0030)**
- Flat folders (one level), `files` in the private bucket `documents` (`<ws>/<file_id>/<uuid>.<ext>`, ≤ 10 MB, pdf/images/office/txt/csv), 60-second signed URLs, folder-based RLS with the uuid guard. Members read; owner/admin/staff write; accountant reads.
- `contract_templates(name, body)` with `{{field}}` merge fields. `renderTemplate(template, data, mode)` escapes values (`html`, the default) or leaves them verbatim for storage as text (`text`, rendered by React). Contracts store the filled text frozen at "send".
- `contracts(contact_id, title, body, status draft|sent|signed|void)` and `contract_signatures` (typed name and optional drawn PNG ≤ 100 KB, signed_at, ip, user agent, SHA-256 of title + body). The UI states that this is an ordinary electronic signature under the ECT Act.
- Portal: `portal_links(contact_id, token, revoked_at)`, one active link per client. `get_portal(token)` (anon) returns only what the page shows: business name, client name, documents (with the existing per-document public token so the existing `/p/<token>` page does payment and quote acceptance) and contracts. `sign_contract` is service-role only behind an IP rate limit (it takes the IP and user agent, so the public key must not be able to call it). A revoked or unknown token is a 404. The portal link is emailed through the outbox (`portal_link`).

## Tasks

1. **5.1 Inventory** — 0027; Stock › Products, movements, suppliers, purchase orders; product picker on invoice lines.
2. **5.2 Team** — 0028; Settings › Team; invite email and accept page; audit log; role matrix test.
3. **5.3 Reports** — 0029; Reports page (four tabs); CSV and PDF export.
4. **5.4 Documents and portal** — 0030; Docs (files, templates, contracts); portal and signing page.

Plus a More-page overflow list so sections that do not fit the phone tab bar (Stock, Reports, Docs, Accounting…) are reachable on a phone.

Each task: SQL test first (RLS isolation, roles, the plan's named tests), unit tests for pure helpers, one e2e journey, commit. Full e2e runs are spaced at least 7 minutes apart (Supabase Auth per-IP rate limit).

## As built (differences from the plan above)

- **Migrations:** 0027 inventory, 0028 team, 0029 reports, 0030 documents, each with a down script and an SQL test (38, 52, 41 and 67 checks). The 0028 test includes the role matrix: 23 actions × 4 roles checked against spec §3.
- **Inventory:** products on invoice lines through a picker in the invoice editor (invoices only; quotes and credit notes do not move stock). Selling below zero is allowed and flagged ("Oversold", and a warning toast on send). Low stock shows as a banner and a list on the Stock page; alerts by push and email arrive with notifications in Phase 6. Purchase orders: draft → sent → received (or cancelled), received in full only.
- **Team:** Settings › Team (More › Team) for owners and admins. The invitation link is `/invite/<token>`; only the person whose email it was sent to can accept. Open invitations are capped at 25 per business. The activity log covers team changes, invoices sent and voided, payments removed, stock adjustments, purchase orders received, and contracts sent, signed and withdrawn.
- **Reports:** invoice basis, owners/admins/accountants. CSV (UTF-8 with a byte-order mark, comma and decimal point) and PDF through `/[ws]/reports/export`. The cash-flow forecast has no opening balance and leaves out repeating invoices (none exist yet).
- **Documents:** Docs has Files, Contracts and Templates. A template's `{{fields}}` are filled when a contract is made (the client, business and date automatically, anything else asked for). A contract is frozen when sent; the client reads and signs it in the portal (typed name, optional drawn mark, a tick-box, and the plain statement that it is an ordinary electronic signature under the ECT Act). The signature record keeps name, time, IP, device and the SHA-256 of the contract as shown.
- **Portal:** `/portal/<token>` lists the client's sent invoices and quotes (each opens the existing `/p/<token>` page to pay or accept) and contracts. One link per client; make, email, replace or turn off from the client's page. A turned-off or unknown link is a 404.
- **More page** now lists the sections that do not fit the phone tab bar (Stock, Reports, Docs, …) so none is out of reach on a phone. The nav gains Reports (owner/admin/accountant) and Docs.
- **Not in Phase 5** (logged as deferred minors in the ledger): emailing purchase orders to suppliers, partial receiving, stock return on credit notes, a payments-basis switch for VAT, an opening bank balance in the forecast, a signed-contract PDF, restoring archived files, reminders for unsigned contracts, folder nesting.
