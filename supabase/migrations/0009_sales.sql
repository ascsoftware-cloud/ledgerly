-- 0009_sales: invoices, quotes and credit notes.
-- Down script: supabase/migrations/down/0009_sales.sql
--
-- Rules the database enforces (so the app cannot get them wrong):
--  * Money is integer cents. Line maths mirrors calcLine/calcTotals in src/lib/money.ts exactly.
--  * Only drafts can be edited. Sent documents change only through the functions below.
--  * Numbers are issued at send time, per workspace and kind, gapless, never reused.
--  * The Free plan sends at most 10 invoices and quotes per calendar month (SAST).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.sales_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'quote', 'credit_note')),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'part_paid', 'paid', 'void')),
  number text,
  contact_id uuid not null,
  issue_date date not null default (now() at time zone 'Africa/Johannesburg')::date,
  due_date date,
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  notes text check (char_length(notes) <= 2000),
  terms text check (char_length(terms) <= 2000),
  deposit_type text check (deposit_type in ('pct', 'amount')),
  -- Percentage (0–100) when deposit_type = 'pct', cents when 'amount'.
  deposit_value numeric(14, 2) check (deposit_value >= 0),
  subtotal_cents bigint not null default 0,
  vat_cents bigint not null default 0,
  total_cents bigint not null default 0,
  deposit_cents bigint not null default 0,
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  credited_cents bigint not null default 0 check (credited_cents >= 0),
  -- The quote an invoice came from, or the invoice a credit note reduces.
  source_id uuid,
  public_token text not null unique
    default translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  voided_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, kind, number),
  check ((status = 'draft') = (number is null)),
  check (deposit_type is null or deposit_value is not null),
  check (deposit_type <> 'pct' or deposit_value <= 100),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_id) references public.sales_documents (workspace_id, id) on delete set null (source_id)
);
create index sales_documents_list_idx on public.sales_documents (workspace_id, kind, created_at desc);
create index sales_documents_status_idx on public.sales_documents (workspace_id, status, due_date);
create index sales_documents_contact_idx on public.sales_documents (workspace_id, contact_id);
create index sales_documents_source_idx on public.sales_documents (workspace_id, source_id);
create index sales_documents_sent_idx on public.sales_documents (workspace_id, sent_at) where sent_at is not null;
create index sales_documents_created_by_idx on public.sales_documents (created_by);

create table public.sales_document_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  position smallint not null check (position between 1 and 200),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity numeric(12, 4) not null check (quantity > 0 and quantity <= 1000000),
  unit_cents bigint not null check (unit_cents between 0 and 10000000000),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate smallint not null default 0 check (vat_rate in (0, 15)),
  net_cents bigint not null default 0,
  vat_cents bigint not null default 0,
  gross_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, document_id) references public.sales_documents (workspace_id, id) on delete cascade
);
create index sales_document_lines_doc_idx on public.sales_document_lines (workspace_id, document_id, position);

create table public.document_sequences (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'quote', 'credit_note')),
  next_number integer not null default 1 check (next_number > 0),
  primary key (workspace_id, kind)
);

create trigger touch_sales_documents before update on public.sales_documents
  for each row execute function app.touch_updated_at();
create trigger fixed_ws_sales_documents before update on public.sales_documents
  for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_sales_lines before update on public.sales_document_lines
  for each row execute function app.forbid_workspace_change();

-- ---------------------------------------------------------------------------
-- Money maths. Mirrors src/lib/money.ts: quantity to 4 dp, discount to 2 dp,
-- VAT on the discounted net, every figure rounded half away from zero per line.
-- ---------------------------------------------------------------------------
create or replace function app.calc_line(qty numeric, unit_cents bigint, discount_pct numeric, vat_rate smallint,
                                         out net bigint, out vat bigint, out gross bigint)
language sql
immutable
set search_path = ''
as $$
  with n as (
    select round(round(qty * 10000) * unit_cents * (10000 - round(discount_pct * 100)) / 100000000.0)::bigint as net
  )
  select n.net, round(n.net * vat_rate / 100.0)::bigint, n.net + round(n.net * vat_rate / 100.0)::bigint from n;
$$;

create or replace function app.recalc_document(doc uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  d public.sales_documents%rowtype;
  dep bigint := 0;
begin
  select coalesce(sum(net_cents), 0) as sub, coalesce(sum(vat_cents), 0) as vat
    into t from public.sales_document_lines where document_id = doc;
  select * into d from public.sales_documents where id = doc;
  if d.deposit_type = 'pct' and t.sub + t.vat > 0 then
    dep := round((t.sub + t.vat) * round(d.deposit_value * 100) / 10000.0);
  elsif d.deposit_type = 'amount' then
    dep := round(d.deposit_value);
  end if;
  update public.sales_documents
  set subtotal_cents = t.sub,
      vat_cents = t.vat,
      total_cents = t.sub + t.vat,
      deposit_cents = least(greatest(dep, 0), t.sub + t.vat)
  where id = doc;
end;
$$;

create or replace function app.line_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  select * into r from app.calc_line(new.quantity, new.unit_cents, new.discount_pct, new.vat_rate);
  new.net_cents := r.net;
  new.vat_cents := r.vat;
  new.gross_cents := r.gross;
  return new;
end;
$$;
create trigger line_totals before insert or update on public.sales_document_lines
  for each row execute function app.line_totals();

-- Only drafts may be edited by people. Functions (running as the owner) may change sent documents.
-- SECURITY INVOKER on purpose: current_user is then the person editing, while the
-- functions below (running as the owner) pass straight through.
create or replace function app.guard_draft_lines()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  doc_status text;
begin
  select status into doc_status from public.sales_documents
  where id = coalesce(new.document_id, old.document_id);
  if current_user in ('authenticated', 'anon') and doc_status is not null and doc_status <> 'draft' then
    raise exception 'Only drafts can be changed. Void it or issue a credit note instead.' using errcode = 'LDG02';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger guard_draft_lines before insert or update or delete on public.sales_document_lines
  for each row execute function app.guard_draft_lines();

create or replace function app.after_lines_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recalc_document(coalesce(new.document_id, old.document_id));
  return null;
end;
$$;
create trigger after_lines_change after insert or update or delete on public.sales_document_lines
  for each row execute function app.after_lines_change();

create or replace function app.guard_draft_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and old.status <> 'draft' then
    raise exception 'Only drafts can be changed. Void it or issue a credit note instead.' using errcode = 'LDG02';
  end if;
  return new;
end;
$$;
create trigger guard_draft_document before update on public.sales_documents
  for each row execute function app.guard_draft_document();

-- Deposit changes on a draft re-run the totals.
create or replace function app.after_document_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deposit_type is distinct from old.deposit_type or new.deposit_value is distinct from old.deposit_value then
    perform app.recalc_document(new.id);
  end if;
  return null;
end;
$$;
create trigger after_document_change after update on public.sales_documents
  for each row execute function app.after_document_change();

create or replace function app.stamp_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := coalesce((select auth.uid()), new.created_by);
  return new;
end;
$$;
create trigger stamp_document before insert on public.sales_documents
  for each row execute function app.stamp_document();

-- ---------------------------------------------------------------------------
-- Saving a draft: document fields and all its lines in one transaction.
-- SECURITY INVOKER, so row-level security applies to every statement.
-- ---------------------------------------------------------------------------
create or replace function public.save_document_draft(p_workspace uuid, p_id uuid, p_doc jsonb, p_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  doc_id uuid := p_id;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'Lines must be a list of at most 200' using errcode = 'check_violation';
  end if;

  if doc_id is null then
    insert into public.sales_documents (workspace_id, kind, contact_id, issue_date, due_date, notes, terms,
                                        deposit_type, deposit_value, source_id)
    values (p_workspace, p_doc ->> 'kind', (p_doc ->> 'contact_id')::uuid,
            coalesce((p_doc ->> 'issue_date')::date, (now() at time zone 'Africa/Johannesburg')::date),
            (p_doc ->> 'due_date')::date, p_doc ->> 'notes', p_doc ->> 'terms',
            p_doc ->> 'deposit_type', (p_doc ->> 'deposit_value')::numeric, (p_doc ->> 'source_id')::uuid)
    returning id into doc_id;
  else
    update public.sales_documents
    set contact_id = (p_doc ->> 'contact_id')::uuid,
        issue_date = coalesce((p_doc ->> 'issue_date')::date, issue_date),
        due_date = (p_doc ->> 'due_date')::date,
        notes = p_doc ->> 'notes',
        terms = p_doc ->> 'terms',
        deposit_type = p_doc ->> 'deposit_type',
        deposit_value = (p_doc ->> 'deposit_value')::numeric
    where id = doc_id and workspace_id = p_workspace;
    if not found then
      raise exception 'Draft not found' using errcode = 'no_data_found';
    end if;
    delete from public.sales_document_lines where document_id = doc_id and workspace_id = p_workspace;
  end if;

  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity,
                                           unit_cents, discount_pct, vat_rate)
  select p_workspace, doc_id, l.ord::smallint, l.v ->> 'description', (l.v ->> 'quantity')::numeric,
         (l.v ->> 'unit_cents')::bigint, coalesce((l.v ->> 'discount_pct')::numeric, 0),
         coalesce((l.v ->> 'vat_rate')::smallint, 0)
  from jsonb_array_elements(p_lines) with ordinality as l (v, ord);

  perform app.recalc_document(doc_id);
  return doc_id;
end;
$$;
revoke all on function public.save_document_draft(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_document_draft(uuid, uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending: issues the number. Safe to call twice (returns the same number).
-- ---------------------------------------------------------------------------
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
    if d.source_id is null or not exists (
      select 1 from public.sales_documents s
      where s.id = d.source_id and s.kind = 'invoice' and s.status not in ('draft', 'void')
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
    update public.sales_documents
    set credited_cents = credited_cents + d.total_cents,
        status = case when total_cents - paid_cents - (credited_cents + d.total_cents) <= 0 then 'paid' else status end
    where id = d.source_id;
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
revoke all on function public.send_document(uuid) from public, anon;
grant execute on function public.send_document(uuid) to authenticated;

-- Quote → invoice. Returns the existing invoice if this quote was already converted.
create or replace function public.convert_quote_to_invoice(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.sales_documents%rowtype;
  inv uuid;
begin
  select * into q from public.sales_documents where id = p_quote and kind = 'quote' for update;
  if not found or not app.has_role(q.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Quote not found' using errcode = 'no_data_found';
  end if;
  if q.status in ('draft', 'declined', 'void') then
    raise exception 'Send the quote before turning it into an invoice' using errcode = 'LDG03';
  end if;
  select id into inv from public.sales_documents
  where workspace_id = q.workspace_id and kind = 'invoice' and source_id = q.id and status <> 'void'
  limit 1;
  if inv is not null then
    return inv;
  end if;

  insert into public.sales_documents (workspace_id, kind, contact_id, notes, terms, deposit_type, deposit_value, source_id)
  values (q.workspace_id, 'invoice', q.contact_id, q.notes, q.terms, q.deposit_type, q.deposit_value, q.id)
  returning id into inv;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity,
                                           unit_cents, discount_pct, vat_rate)
  select workspace_id, inv, position, description, quantity, unit_cents, discount_pct, vat_rate
  from public.sales_document_lines where document_id = q.id;
  perform app.recalc_document(inv);
  return inv;
end;
$$;
revoke all on function public.convert_quote_to_invoice(uuid) from public, anon;
grant execute on function public.convert_quote_to_invoice(uuid) to authenticated;

-- Draft credit note for an invoice, prefilled with its lines (edit them down before sending).
create or replace function public.create_credit_note(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.sales_documents%rowtype;
  cn uuid;
begin
  select * into i from public.sales_documents where id = p_invoice and kind = 'invoice';
  if not found or not app.has_role(i.workspace_id, array['owner', 'admin']) then
    raise exception 'Invoice not found' using errcode = 'no_data_found';
  end if;
  if i.status in ('draft', 'void') then
    raise exception 'Only sent invoices can be credited' using errcode = 'LDG03';
  end if;
  insert into public.sales_documents (workspace_id, kind, contact_id, source_id, notes)
  values (i.workspace_id, 'credit_note', i.contact_id, i.id, 'Credit note for ' || i.number)
  returning id into cn;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity,
                                           unit_cents, discount_pct, vat_rate)
  select workspace_id, cn, position, description, quantity, unit_cents, discount_pct, vat_rate
  from public.sales_document_lines where document_id = i.id;
  perform app.recalc_document(cn);
  return cn;
end;
$$;
revoke all on function public.create_credit_note(uuid) from public, anon;
grant execute on function public.create_credit_note(uuid) to authenticated;

-- Voiding keeps the number (gapless) but cancels the document. Not allowed once money is in.
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
  if d.status = 'draft' then
    raise exception 'Delete a draft instead of voiding it' using errcode = 'LDG03';
  end if;
  if d.paid_cents > 0 or d.credited_cents > 0 then
    raise exception 'This invoice has payments or credits. Issue a credit note instead.' using errcode = 'LDG03';
  end if;
  update public.sales_documents set status = 'void', voided_at = now() where id = d.id;
end;
$$;
revoke all on function public.void_document(uuid) from public, anon;
grant execute on function public.void_document(uuid) to authenticated;

revoke all on function app.calc_line(numeric, bigint, numeric, smallint) from public, anon, authenticated;
revoke all on function app.recalc_document(uuid) from public, anon, authenticated;
revoke all on function app.line_totals() from public, anon, authenticated;
revoke all on function app.guard_draft_lines() from public, anon, authenticated;
revoke all on function app.after_lines_change() from public, anon, authenticated;
revoke all on function app.guard_draft_document() from public, anon, authenticated;
revoke all on function app.after_document_change() from public, anon, authenticated;
revoke all on function app.stamp_document() from public, anon, authenticated;
-- calc_line runs inside the line trigger as the invoking user.
grant execute on function app.calc_line(numeric, bigint, numeric, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.sales_documents enable row level security;
alter table public.sales_document_lines enable row level security;
alter table public.document_sequences enable row level security;

revoke all on public.sales_documents, public.sales_document_lines, public.document_sequences from anon, authenticated;

grant select on public.sales_documents to authenticated;
grant insert (workspace_id, kind, contact_id, issue_date, due_date, notes, terms, deposit_type, deposit_value, source_id)
  on public.sales_documents to authenticated;
grant update (contact_id, issue_date, due_date, notes, terms, deposit_type, deposit_value)
  on public.sales_documents to authenticated;
grant delete on public.sales_documents to authenticated;

grant select, delete on public.sales_document_lines to authenticated;
grant insert (workspace_id, document_id, position, description, quantity, unit_cents, discount_pct, vat_rate)
  on public.sales_document_lines to authenticated;
grant update (position, description, quantity, unit_cents, discount_pct, vat_rate)
  on public.sales_document_lines to authenticated;

create policy sales_documents_select on public.sales_documents for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy sales_documents_insert on public.sales_documents for insert to authenticated
  with check (status = 'draft' and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy sales_documents_update on public.sales_documents for update to authenticated
  using (status = 'draft' and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check (status = 'draft' and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy sales_documents_delete on public.sales_documents for delete to authenticated
  using (status = 'draft' and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy sales_document_lines_select on public.sales_document_lines for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy sales_document_lines_insert on public.sales_document_lines for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy sales_document_lines_update on public.sales_document_lines for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy sales_document_lines_delete on public.sales_document_lines for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

-- No policies on document_sequences: only send_document touches it.
create policy document_sequences_no_direct_access on public.document_sequences
  as restrictive for all to anon, authenticated using (false) with check (false);
