-- 0019_review_fixes: fixes from the Phase 3 whole-branch review.
--   1. Voiding a credit note gives the credit back to its invoice (and voiding twice is a no-op).
--   2. Only owners and admins can issue credit notes, however the row is created.
--   3. Manual payments cannot exceed what is owed, and an owner/admin can remove a mistaken one.
--   4. A new Yoco key waits as 'pending' and only replaces the working connection once its
--      webhook is registered; the replaced connection's keys can then be purged.
--   7. Emailing a document is throttled (5 per document and 30/300 per workspace a day).
--   8. A workspace member opening their own link does not mark it viewed.
-- Down script: supabase/migrations/down/0019_review_fixes.sql

alter table public.activities drop constraint activities_kind_check;
alter table public.activities add constraint activities_kind_check
  check (kind in ('contact_created', 'note_added', 'quote_sent', 'quote_accepted', 'invoice_sent',
                  'invoice_viewed', 'payment_received', 'payment_removed', 'deal_moved'));

alter table public.payment_connections drop constraint payment_connections_status_check;
alter table public.payment_connections add constraint payment_connections_status_check
  check (status in ('pending', 'active', 'disabled'));

-- An invoice's status follows from its money: paid, part paid, or still owing (viewed or not).
create or replace function app.settle_status(doc uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sales_documents
  set status = case
    when total_cents - paid_cents - credited_cents <= 0 then 'paid'
    when paid_cents > 0 then 'part_paid'
    when viewed_at is not null then 'viewed'
    else 'sent'
  end
  where id = doc and kind = 'invoice' and status not in ('draft', 'void');
$$;
revoke all on function app.settle_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Credit notes: owner/admin only, even when inserted directly.
-- ---------------------------------------------------------------------------
drop policy sales_documents_insert on public.sales_documents;
create policy sales_documents_insert on public.sales_documents for insert to authenticated
  with check (status = 'draft'
              and (select app.has_role(workspace_id, array['owner', 'admin', 'staff']))
              and (kind <> 'credit_note' or (select app.has_role(workspace_id, array['owner', 'admin']))));

create or replace function public.send_document(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents%rowtype;
  seq integer;
  prefix text;
  month_start timestamptz;
  sent_this_month integer;
  ws_plan text;
  line_count integer;
begin
  select * into d from public.sales_documents where id = p_id for update;
  if not found or not app.has_role(d.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Document not found' using errcode = 'no_data_found';
  end if;
  if d.number is not null then
    return jsonb_build_object('number', d.number, 'status', d.status, 'already_sent', true);
  end if;
  if d.kind = 'credit_note' and not app.has_role(d.workspace_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can issue credit notes' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into line_count from public.sales_document_lines where document_id = d.id;
  if line_count = 0 or d.total_cents <= 0 then
    raise exception 'Add at least one line with an amount before sending' using errcode = 'LDG03';
  end if;
  if exists (select 1 from public.contacts c where c.id = d.contact_id and c.deleted_at is not null) then
    raise exception 'This client is archived. Restore them first.' using errcode = 'LDG03';
  end if;

  select plan into ws_plan from public.workspaces where id = d.workspace_id;
  if ws_plan = 'free' and d.kind in ('invoice', 'quote') then
    month_start := date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
    select count(*) into sent_this_month from public.sales_documents
    where workspace_id = d.workspace_id and kind in ('invoice', 'quote') and sent_at >= month_start;
    if sent_this_month >= 10 then
      raise exception 'The Free plan sends 10 invoices and quotes a month' using errcode = 'LDG01';
    end if;
  end if;

  if d.kind = 'credit_note' then
    -- Lock the invoice so two credit notes sent at once cannot over-credit it.
    perform 1 from public.sales_documents s where s.id = d.source_id and s.workspace_id = d.workspace_id for update;
    if d.source_id is null or not exists (
      select 1 from public.sales_documents s
      where s.id = d.source_id and s.workspace_id = d.workspace_id and s.kind = 'invoice'
        and s.status not in ('draft', 'void')
        and d.total_cents <= s.total_cents - s.credited_cents
    ) then
      raise exception 'A credit note cannot be more than what is left on the invoice' using errcode = 'LDG03';
    end if;
  end if;

  insert into public.document_sequences (workspace_id, kind) values (d.workspace_id, d.kind)
  on conflict (workspace_id, kind) do nothing;
  update public.document_sequences set next_number = next_number + 1
  where workspace_id = d.workspace_id and kind = d.kind
  returning next_number - 1 into seq;

  prefix := case d.kind
    when 'invoice' then coalesce((select invoice_prefix from public.workspace_settings where workspace_id = d.workspace_id), 'INV-')
    when 'quote' then 'QUO-'
    else 'CN-'
  end;

  update public.sales_documents
  set number = prefix || lpad(seq::text, 4, '0'),
      status = 'sent',
      sent_at = now(),
      issue_date = (now() at time zone 'Africa/Johannesburg')::date,
      due_date = coalesce(due_date, (now() at time zone 'Africa/Johannesburg')::date
                                    + case when d.kind = 'quote' then 30 else 14 end)
  where id = d.id
  returning * into d;

  if d.kind = 'credit_note' then
    update public.sales_documents set credited_cents = credited_cents + d.total_cents where id = d.source_id;
    perform app.settle_status(d.source_id);
  end if;

  insert into public.activities (workspace_id, contact_id, kind, ref_id, summary, actor_id)
  values (d.workspace_id, d.contact_id,
          case when d.kind = 'quote' then 'quote_sent' else 'invoice_sent' end, d.id,
          case d.kind when 'quote' then 'Quote ' when 'invoice' then 'Invoice ' else 'Credit note ' end
            || d.number || ' sent', (select auth.uid()));

  if d.kind = 'invoice' then
    perform app.award_xp(d.workspace_id, (select auth.uid()), 'invoice_sent', d.id::text);
    perform app.complete_quest_step(d.workspace_id, 'first_invoice');
  end if;

  return jsonb_build_object('number', d.number, 'status', d.status, 'already_sent', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Voiding a credit note returns the credit to the invoice.
-- ---------------------------------------------------------------------------
create or replace function public.void_document(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents%rowtype;
begin
  select * into d from public.sales_documents where id = p_id for update;
  if not found or not app.has_role(d.workspace_id, array['owner', 'admin']) then
    raise exception 'Document not found' using errcode = 'no_data_found';
  end if;
  if d.status = 'void' then
    return;
  end if;
  if d.status = 'draft' then
    raise exception 'Delete a draft instead of voiding it' using errcode = 'LDG03';
  end if;
  if d.paid_cents > 0 or d.credited_cents > 0 then
    raise exception 'This invoice has payments or credits. Issue a credit note instead.' using errcode = 'LDG03';
  end if;
  update public.sales_documents set status = 'void', voided_at = now() where id = d.id;

  if d.kind = 'credit_note' and d.source_id is not null then
    perform 1 from public.sales_documents where id = d.source_id and workspace_id = d.workspace_id for update;
    update public.sales_documents set credited_cents = greatest(credited_cents - d.total_cents, 0)
    where id = d.source_id and workspace_id = d.workspace_id;
    perform app.settle_status(d.source_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Manual payments: never more than what is owed, and removable by owner/admin.
-- ---------------------------------------------------------------------------
create or replace function public.record_manual_payment(p_doc uuid, p_amount_cents bigint, p_method text,
                                                        p_paid_on date, p_reference text, p_proof_path text, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents%rowtype;
begin
  select * into d from public.sales_documents where id = p_doc for update;
  if not found or not app.has_role(d.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Invoice not found' using errcode = 'no_data_found';
  end if;
  if p_method not in ('eft', 'cash', 'card', 'other') then
    raise exception 'Choose how it was paid' using errcode = 'LDG03';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter the amount paid' using errcode = 'LDG03';
  end if;
  if p_paid_on > (now() at time zone 'Africa/Johannesburg')::date then
    raise exception 'The payment date cannot be in the future' using errcode = 'LDG03';
  end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> d.workspace_id::text then
    raise exception 'That proof of payment belongs elsewhere' using errcode = 'LDG03';
  end if;
  -- A repeat of the same button press is answered as a duplicate, not refused as too much.
  if not exists (select 1 from public.payments where method = p_method and provider_ref = 'manual:' || p_request)
     and p_amount_cents > d.total_cents - d.paid_cents - d.credited_cents then
    raise exception 'That is more than what is still owed on this invoice' using errcode = 'LDG03';
  end if;
  return app.apply_payment(d.workspace_id, p_doc, p_method, p_amount_cents, p_paid_on, left(nullif(btrim(p_reference), ''), 120),
                           'manual:' || p_request, (select auth.uid()), p_proof_path);
end;
$$;

create or replace function public.remove_payment(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
  d public.sales_documents%rowtype;
begin
  select * into p from public.payments where id = p_payment;
  if not found or not app.has_role(p.workspace_id, array['owner', 'admin']) then
    raise exception 'Payment not found' using errcode = 'no_data_found';
  end if;
  if p.method in ('yoco', 'payfast') then
    raise exception 'Card payments confirmed by Yoco or PayFast cannot be removed here. Refund them with the provider and issue a credit note.'
      using errcode = 'LDG03';
  end if;
  select * into d from public.sales_documents where id = p.document_id and workspace_id = p.workspace_id for update;
  delete from public.payments where id = p.id;
  update public.sales_documents set paid_cents = greatest(paid_cents - p.amount_cents, 0) where id = d.id;
  perform app.settle_status(d.id);
  insert into public.activities (workspace_id, contact_id, kind, ref_id, summary, actor_id)
  values (p.workspace_id, d.contact_id, 'payment_removed', d.id,
          left('Payment removed from ' || d.number || ' (' || p.method || ')', 300), (select auth.uid()));
end;
$$;
revoke all on function public.remove_payment(uuid) from public, anon;
grant execute on function public.remove_payment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Yoco reconnects: the working connection stays until the new one is complete.
-- ---------------------------------------------------------------------------
create or replace function public.connect_payment_provider(p_workspace uuid, p_provider text, p_mode text,
                                                           p_merchant_id text, p_secret text, p_passphrase text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  conn uuid;
  secret_ref uuid;
  pass_ref uuid;
begin
  if not app.has_role(p_workspace, array['owner', 'admin']) then
    raise exception 'Only owners and admins can connect payments' using errcode = 'insufficient_privilege';
  end if;
  if p_provider not in ('yoco', 'payfast') or p_mode not in ('test', 'live') then
    raise exception 'Unknown provider or mode' using errcode = 'LDG03';
  end if;
  if p_provider = 'yoco' and coalesce(p_secret, '') !~ '^sk_(test|live)_[A-Za-z0-9]{10,200}$' then
    raise exception 'That does not look like a Yoco secret key (it starts with sk_test_ or sk_live_)' using errcode = 'LDG03';
  end if;
  if p_provider = 'yoco' and (p_mode = 'live') <> (p_secret like 'sk_live_%') then
    raise exception 'Use a live key for live mode and a test key for test mode' using errcode = 'LDG03';
  end if;
  if p_provider = 'payfast' and (coalesce(p_merchant_id, '') !~ '^[0-9]{6,12}$' or coalesce(p_secret, '') !~ '^[A-Za-z0-9]{8,40}$') then
    raise exception 'Check the PayFast merchant ID and merchant key' using errcode = 'LDG03';
  end if;

  -- PayFast has no registration step, so the new details replace the old at once.
  -- A Yoco key waits as 'pending' until attach_yoco_webhook confirms Yoco accepted it.
  if p_provider = 'payfast' then
    update public.payment_connections set status = 'disabled'
    where workspace_id = p_workspace and provider = p_provider and status = 'active';
  end if;

  secret_ref := vault.create_secret(p_secret, 'pay:' || gen_random_uuid(), p_provider || ' secret for workspace ' || p_workspace);
  if coalesce(btrim(p_passphrase), '') <> '' then
    pass_ref := vault.create_secret(btrim(p_passphrase), 'pay:' || gen_random_uuid(), 'payfast passphrase for workspace ' || p_workspace);
  end if;

  insert into public.payment_connections (workspace_id, provider, mode, merchant_id, secret_id, passphrase_id, created_by, status)
  values (p_workspace, p_provider, p_mode, case when p_provider = 'payfast' then p_merchant_id end, secret_ref, pass_ref,
          (select auth.uid()), case when p_provider = 'yoco' then 'pending' else 'active' end)
  returning id into conn;

  if p_provider = 'payfast' then
    perform app.complete_quest_step(p_workspace, 'get_paid_setup');
  end if;
  return conn;
end;
$$;

/** Completes a pending Yoco connection and switches over to it. Returns the connection it replaced, if any. */
drop function public.attach_yoco_webhook(uuid, text, text);
create function public.attach_yoco_webhook(p_connection uuid, p_webhook_id text, p_webhook_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.payment_connections%rowtype;
  replaced uuid;
begin
  select * into c from public.payment_connections where id = p_connection and provider = 'yoco' and status = 'pending' for update;
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin']) then
    raise exception 'Connection not found' using errcode = 'no_data_found';
  end if;
  if coalesce(p_webhook_secret, '') !~ '^whsec_[A-Za-z0-9+/=]{16,200}$' then
    raise exception 'Unexpected webhook secret from Yoco' using errcode = 'LDG03';
  end if;
  update public.payment_connections set status = 'disabled'
  where workspace_id = c.workspace_id and provider = 'yoco' and status = 'active'
  returning id into replaced;
  update public.payment_connections
  set status = 'active',
      webhook_id = left(p_webhook_id, 100),
      webhook_secret_id = vault.create_secret(p_webhook_secret, 'pay:' || gen_random_uuid(), 'yoco webhook secret for workspace ' || c.workspace_id)
  where id = c.id;
  perform app.complete_quest_step(c.workspace_id, 'get_paid_setup');
  return replaced;
end;
$$;
revoke all on function public.attach_yoco_webhook(uuid, text, text) from public, anon;
grant execute on function public.attach_yoco_webhook(uuid, text, text) to authenticated;

/** Server only: deletes the stored keys of a connection that is no longer in use. */
create or replace function public.purge_connection_secrets(p_connection uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.payment_connections%rowtype;
begin
  select * into c from public.payment_connections where id = p_connection and status = 'disabled';
  if not found then
    return;
  end if;
  delete from vault.secrets where id in (c.secret_id, c.passphrase_id, c.webhook_secret_id);
  update public.payment_connections set secret_id = null, passphrase_id = null, webhook_secret_id = null where id = c.id;
end;
$$;
revoke all on function public.purge_connection_secrets(uuid) from public, anon, authenticated;
grant execute on function public.purge_connection_secrets(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Email throttling, so no one account can burn the shared sending domain.
-- ---------------------------------------------------------------------------
create or replace function public.queue_document_email(p_doc uuid, p_to text, p_message text, p_request uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents%rowtype;
  to_addr text := lower(btrim(coalesce(p_to, '')));
  sender_email text;
  out_id uuid;
  v_key text := 'document:' || p_doc || ':' || p_request;
  sent_today integer;
  ws_plan text;
begin
  select * into d from public.sales_documents where id = p_doc;
  if not found or not app.has_role(d.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Document not found' using errcode = 'no_data_found';
  end if;
  -- The same button press again is the same email, never a new one and never refused.
  select id into out_id from public.outbox where idempotency_key = v_key;
  if out_id is not null then
    return out_id;
  end if;
  if d.status = 'draft' then
    raise exception 'Send the document before emailing it' using errcode = 'LDG03';
  end if;
  if d.status = 'void' then
    raise exception 'This document was voided' using errcode = 'LDG03';
  end if;
  if to_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(to_addr) > 254 then
    raise exception 'That email address does not look right' using errcode = 'LDG03';
  end if;
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception 'Keep the message under 1 000 characters' using errcode = 'LDG03';
  end if;

  -- Serialise per workspace so the counts below cannot be raced.
  perform 1 from public.workspaces where id = d.workspace_id for update;
  select count(*) into sent_today from public.outbox
  where workspace_id = d.workspace_id and template = 'document' and payload ->> 'document_id' = d.id::text
    and created_at > now() - interval '1 day';
  if sent_today >= 5 then
    raise exception 'This document has been emailed 5 times today. Try again tomorrow.' using errcode = 'LDG03';
  end if;
  select plan into ws_plan from public.workspaces where id = d.workspace_id;
  select count(*) into sent_today from public.outbox
  where workspace_id = d.workspace_id and template = 'document' and created_at > now() - interval '1 day';
  if sent_today >= (case when ws_plan = 'free' then 30 else 300 end) then
    raise exception 'You have reached today''s email limit. Share the link on WhatsApp instead, or try again tomorrow.'
      using errcode = 'LDG03';
  end if;

  select email into sender_email from auth.users where id = (select auth.uid());

  insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key, created_by)
  values (d.workspace_id, 'document', to_addr, lower(sender_email),
          jsonb_build_object('document_id', d.id, 'message', nullif(btrim(coalesce(p_message, '')), '')),
          v_key, (select auth.uid()))
  on conflict (idempotency_key) do nothing
  returning id into out_id;

  if out_id is null then
    select id into out_id from public.outbox where idempotency_key = v_key;
  end if;
  return out_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The business testing its own link is not the client opening it.
-- ---------------------------------------------------------------------------
create or replace function public.mark_document_viewed(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents;
begin
  d := app.document_by_token(p_token);
  if d.id is null or d.viewed_at is not null then
    return;
  end if;
  if (select auth.uid()) is not null and app.is_member(d.workspace_id) then
    return;
  end if;
  update public.sales_documents
  set viewed_at = now(), status = case when status = 'sent' then 'viewed' else status end
  where id = d.id;
  insert into public.activities (workspace_id, contact_id, kind, ref_id, summary)
  values (d.workspace_id, d.contact_id, 'invoice_viewed', d.id,
          case when d.kind = 'quote' then 'Quote ' else 'Invoice ' end || d.number || ' opened by the client');
end;
$$;
