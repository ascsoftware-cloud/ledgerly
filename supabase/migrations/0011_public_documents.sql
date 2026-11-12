-- 0011_public_documents: the client-facing document page (/p/<token>), quote acceptance
-- with an electronic signature, and view tracking.
-- Down: drop function public.get_public_document(text), public.mark_document_viewed(text),
--       public.accept_quote(text, text, text, text); drop table public.signatures;
--
-- Public access never touches tables directly. These functions take the unguessable token,
-- return only what the page shows, and refuse drafts.

create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  signer_name text not null check (char_length(btrim(signer_name)) between 2 and 120),
  signed_at timestamptz not null default now(),
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 400),
  -- SHA-256 of exactly what was shown and accepted, so the record can be checked later.
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  unique (document_id),
  foreign key (workspace_id, document_id) references public.sales_documents (workspace_id, id) on delete cascade
);
create index signatures_ws_idx on public.signatures (workspace_id, document_id);

alter table public.signatures enable row level security;
revoke all on public.signatures from anon, authenticated;
grant select on public.signatures to authenticated;
create policy signatures_select on public.signatures for select to authenticated
  using ((select app.is_member(workspace_id)));

-- The document exactly as the client sees it. Also hashed when a quote is accepted.
create or replace function app.public_document_json(d public.sales_documents)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', d.kind,
    'number', d.number,
    'status', d.status,
    'issue_date', d.issue_date,
    'due_date', d.due_date,
    'notes', d.notes,
    'subtotal_cents', d.subtotal_cents,
    'vat_cents', d.vat_cents,
    'total_cents', d.total_cents,
    'deposit_cents', d.deposit_cents,
    'paid_cents', d.paid_cents,
    'credited_cents', d.credited_cents,
    'accepted_at', d.accepted_at,
    'source_number', (select s.number from public.sales_documents s where s.id = d.source_id),
    'business', (
      select jsonb_build_object(
        'name', coalesce(nullif(btrim(ws.business_name), ''), w.name),
        'vat_registered', ws.vat_registered,
        'vat_number', ws.vat_number,
        'registration_number', ws.registration_number,
        'bank_details', case when d.kind = 'invoice' then ws.bank_details end)
      from public.workspaces w join public.workspace_settings ws on ws.workspace_id = w.id
      where w.id = d.workspace_id),
    'client', (
      select jsonb_build_object('name', c.name, 'address', c.address, 'company', co.name, 'company_vat', co.vat_number)
      from public.contacts c left join public.companies co on co.id = c.company_id
      where c.id = d.contact_id),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', l.description, 'quantity', l.quantity, 'unit_cents', l.unit_cents,
        'discount_pct', l.discount_pct, 'vat_rate', l.vat_rate, 'net_cents', l.net_cents,
        'gross_cents', l.gross_cents) order by l.position)
      from public.sales_document_lines l where l.document_id = d.id), '[]'::jsonb)
  );
$$;
revoke all on function app.public_document_json(public.sales_documents) from public, anon, authenticated;

create or replace function app.document_by_token(p_token text)
returns public.sales_documents
language sql
stable
security definer
set search_path = ''
as $$
  select d.* from public.sales_documents d
  join public.workspaces w on w.id = d.workspace_id
  where p_token ~ '^[A-Za-z0-9_-]{32}$' and d.public_token = p_token
    and d.status <> 'draft' and w.deleted_at is null;
$$;
revoke all on function app.document_by_token(text) from public, anon, authenticated;

/** Read-only view of a sent document, by its link token. Null when there is nothing to show. */
create or replace function public.get_public_document(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.sales_documents;
begin
  d := app.document_by_token(p_token);
  if d.id is null then
    return null;
  end if;
  return app.public_document_json(d);
end;
$$;

/** First open of a sent document: mark it viewed and tell the business. Repeat opens do nothing. */
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
  update public.sales_documents
  set viewed_at = now(), status = case when status = 'sent' then 'viewed' else status end
  where id = d.id;
  insert into public.activities (workspace_id, contact_id, kind, ref_id, summary)
  values (d.workspace_id, d.contact_id, 'invoice_viewed', d.id,
          case when d.kind = 'quote' then 'Quote ' else 'Invoice ' end || d.number || ' opened by the client');
end;
$$;

/**
 * The client accepts a quote by typing their name. Records who, when, from where and a hash
 * of exactly what they saw. Safe to repeat: a second acceptance returns the first.
 */
create or replace function public.accept_quote(p_token text, p_name text, p_ip text, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents;
  existing public.signatures;
  hash text;
begin
  d := app.document_by_token(p_token);
  if d.id is null or d.kind <> 'quote' then
    raise exception 'Quote not found' using errcode = 'no_data_found';
  end if;
  select * into existing from public.signatures where document_id = d.id;
  if found then
    return jsonb_build_object('accepted_at', existing.signed_at, 'signer_name', existing.signer_name, 'already', true);
  end if;
  if d.status not in ('sent', 'viewed') then
    raise exception 'This quote can no longer be accepted' using errcode = 'LDG03';
  end if;
  if d.due_date is not null and d.due_date < (now() at time zone 'Africa/Johannesburg')::date then
    raise exception 'This quote has expired. Ask for a new one.' using errcode = 'LDG03';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Type your full name to accept' using errcode = 'LDG03';
  end if;

  hash := encode(extensions.digest(convert_to(app.public_document_json(d)::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.signatures (workspace_id, document_id, signer_name, ip_address, user_agent, document_hash)
  values (d.workspace_id, d.id, left(btrim(p_name), 120), left(p_ip, 64), left(p_user_agent, 400), hash);
  update public.sales_documents set status = 'accepted', accepted_at = now() where id = d.id;
  insert into public.activities (workspace_id, contact_id, kind, ref_id, summary)
  values (d.workspace_id, d.contact_id, 'quote_accepted', d.id,
          left('Quote ' || d.number || ' accepted by ' || btrim(p_name), 300));
  return jsonb_build_object('accepted_at', now(), 'signer_name', btrim(p_name), 'already', false);
end;
$$;

-- Callable without signing in: the token is the key. Rate-limited in the app.
revoke all on function public.get_public_document(text) from public;
revoke all on function public.mark_document_viewed(text) from public;
revoke all on function public.accept_quote(text, text, text, text) from public;
grant execute on function public.get_public_document(text) to anon, authenticated;
grant execute on function public.mark_document_viewed(text) to anon, authenticated;
grant execute on function public.accept_quote(text, text, text, text) to anon, authenticated;
