# Phase 3 step plan — clients, invoices, quotes, payments

Expands Phase 3 of `docs/plan.md`. Spec: `docs/spec.md` §6.2–6.4, §7 (outbox), §8.2 (Free limit). Global Constraints and Review Focus of the master plan apply.

## Verified external rules (2026-11-12)

### PayFast (official docs, developers.payfast.co.za/docs)
- Process URL: `https://www.payfast.co.za/eng/process`, sandbox `https://sandbox.payfast.co.za/eng/process`. Form POST.
- Fields used, **in this order** (signature order = documented order): `merchant_id, merchant_key, return_url, cancel_url, notify_url, name_first, name_last, email_address, cell_number, m_payment_id, amount, item_name, item_description, custom_int1..5, custom_str1..5, email_confirmation, confirmation_address, payment_method`.
- Signature: join `key=urlencode(trim(value))` for every **non-blank** field with `&`; append `&passphrase=urlencode(trim(passphrase))` when a passphrase is set; MD5, lower-case hex. Encoding is PHP `urlencode`: spaces as `+`, upper-case hex, everything except `A–Z a–z 0–9 - _ .` encoded.
- `amount` is a decimal string with two places (`"100.00"`).
- ITN (POST to `notify_url`, `application/x-www-form-urlencoded`): reply 200 quickly; otherwise retried. Sandbox sends each ITN only once.
- ITN checks, all four required: (1) signature over all posted fields **in received order up to (excluding) `signature`**, values PHP-urlencoded, plus passphrase; (2) source IP is one of the resolved IPs of `www.payfast.co.za`, `w1w.payfast.co.za`, `w2w.payfast.co.za`, `sandbox.payfast.co.za`; (3) `amount_gross` within R0.01 of what we expect; (4) POST the same param string to `/eng/query/validate` on the same host and require the body `VALID`.
- `payment_status`: `COMPLETE` (paid), `CANCELLED`. `pf_payment_id` is PayFast's unique transaction id; `m_payment_id` is ours.

### Yoco Checkout API (developer.yoco.com)
- `POST https://payments.yoco.com/api/checkouts`, `Authorization: Bearer <secret key>`, optional `Idempotency-Key`. Body: `amount` (int cents), `currency: "ZAR"`, `successUrl`, `cancelUrl`, `failureUrl`, `metadata`, `externalId`, `lineItems`. Response: `id`, `redirectUrl`, `status`, `processingMode` (`live`|`test`).
- Webhook registration: `POST https://payments.yoco.com/api/webhooks` with `{name, url}` using the merchant's key; response `secret` (shown once), `id`, `mode`. Max 5 per account.
- Verification: headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; signed content `${id}.${timestamp}.${rawBody}`; key = base64-decode of the secret after stripping `whsec_`; HMAC-SHA256, base64; header holds space-separated `v1,<sig>` entries; constant-time compare; reject timestamps more than 3 minutes off.
- Event `type: "payment.succeeded"`; `payload.id`, `payload.amount` (cents), `payload.currency`, `payload.mode`, `payload.metadata`. Whether `metadata.checkoutId` is present is **not documented**: we put our own `ledgerlyRef` in checkout metadata and also match on amount; confirmed in sandbox before go-live.

## Design rulings for this phase
- **Per-business payment accounts.** Each workspace connects its own Yoco/PayFast account. Secrets live in Supabase Vault; `payment_connections` stores only Vault secret ids. Webhook URLs carry the connection id (`/api/webhooks/yoco/<id>`, `/api/webhooks/payfast/<id>`) so the right secret verifies each event.
- **Scheduled work** (outbox sending, reminders, recurring invoices) runs from `pg_cron` + `pg_net` calling `/api/jobs/<job>` with a shared secret, because Vercel's free plan allows only daily crons.
- **Public links** use a random 32-byte token stored in the row (rotatable, revocable); pages read through narrow `security definer` functions only.
- **Totals** are computed in SQL by a function that mirrors `calcTotals` exactly; a test runs the same fixtures through both.

## Tasks (each: tests first, then code, then commit)
1. **3.1 Clients** — `companies`, `contacts`, `tags`, `contact_tags`, `notes`, `activities` + RLS + SQL tests; list/detail/create/edit/delete (undo); CSV import with mapping, preview and per-row errors.
2. **3.2 Pipeline** — `pipeline_stages` (seeded on provisioning), `deals`; kanban with keyboard move.
3. **3.3 Sales documents** — `sales_documents`, `sales_document_lines`, `document_sequences`; `send_document()` (gapless number, idempotent, Free limit 10/month SAST); editor; quote → invoice; credit notes; statuses.
4. **3.4 PDF and public page** — server PDF (one template first, three by end of phase); `/p/[token]` view, accept and sign quote, pay.
5. **3.5 Sending** — `outbox` + worker route + pg_cron; Resend email; WhatsApp share link.
6. **3.6 Payments** — Vault-backed connections UI; Yoco checkout + webhook; PayFast form + ITN; EFT mark-as-paid with proof upload; `apply_payment_event()` idempotent on `(provider, event_id)`.
7. **3.7 Quick add + reminders**, phase gate (check, e2e, SQL suites, advisors), deploy.

**Needs from owner:** Yoco test secret key, PayFast sandbox merchant id/key/passphrase (in `.env.local` only for tests; real merchants enter their own in the app), Resend API key.
