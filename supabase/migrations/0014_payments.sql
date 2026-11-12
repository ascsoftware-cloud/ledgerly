-- 0014_payments: each business connects its own Yoco/PayFast account (keys in Vault),
-- clients pay through hosted checkouts, and every payment is applied exactly once.
-- Down script: supabase/migrations/down/0014_payments.sql

create table public.payment_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('yoco', 'payfast')),
  mode text not null check (mode in ('test', 'live')),
  merchant_id text check (merchant_id ~ '^[0-9]{6,12}$'),
  -- Vault ids only. The secrets themselves never sit in a table.
  secret_id uuid,
  passphrase_id uuid,
  webhook_secret_id uuid,
  webhook_id text check (char_length(webhook_id) <= 100),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index payment_connections_one_active on public.payment_connections (workspace_id, provider) where status = 'active';
create index payment_connections_created_by_idx on public.payment_connections (created_by);

create table public.payment_checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  connection_id uuid not null,
  provider text not null check (provider in ('yoco', 'payfast')),
  amount_cents bigint not null check (amount_cents > 0),
  provider_checkout_id text check (char_length(provider_checkout_id) <= 200),
  status text not null default 'created' check (status in ('created', 'paid')),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, document_id) references public.sales_documents (workspace_id, id) on delete cascade,
  foreign key (workspace_id, connection_id) references public.payment_connections (workspace_id, id) on delete cascade
);
create index payment_checkouts_doc_idx on public.payment_checkouts (workspace_id, document_id);
create index payment_checkouts_conn_idx on public.payment_checkouts (workspace_id, connection_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  method text not null check (method in ('yoco', 'payfast', 'eft', 'cash', 'card', 'other')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  paid_on date not null default (now() at time zone 'Africa/Johannesburg')::date,
  reference text check (char_length(reference) <= 120),
  -- The provider's transaction id, or "manual:<request id>": the same payment twice is one payment.
  provider_ref text not null check (char_length(provider_ref) between 3 and 200),
  proof_path text check (char_length(proof_path) <= 300),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (method, provider_ref),
  foreign key (workspace_id, document_id) references public.sales_documents (workspace_id, id) on delete restrict
);
create index payments_doc_idx on public.payments (workspace_id, document_id);
create index payments_paid_on_idx on public.payments (workspace_id, paid_on);
create index payments_recorded_by_idx on public.payments (recorded_by);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('yoco', 'payfast')),
  event_id text not null check (char_length(event_id) between 1 and 200),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  connection_id uuid,
  payload jsonb not null,
  outcome text not null check (char_length(outcome) <= 200),
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
create index payment_events_ws_idx on public.payment_events (workspace_id, received_at desc);

create trigger touch_payment_connections before update on public.payment_connections
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Applying a payment (shared by EFT/cash entries and provider notifications)
-- ---------------------------------------------------------------------------
create or replace function app.apply_payment(ws uuid, doc uuid, how text, amount bigint, on_date date,
                                             p_ref text, p_provider_ref text, actor uuid, proof text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents%rowtype;
  pay_id uuid;
  first_payment boolean;
begin
  select * into d from public.sales_documents where id = doc and workspace_id = ws for update;
  if not found or d.kind <> 'invoice' then
    raise exception 'Invoice not found' using errcode = 'no_data_found';
  end if;
  if d.status in ('draft', 'void') then
    raise exception 'Payments can only be recorded on sent invoices' using errcode = 'LDG03';
  end if;

  select not exists (select 1 from public.payments p where p.workspace_id = ws) into first_payment;

  insert into public.payments (workspace_id, document_id, method, amount_cents, paid_on, reference, provider_ref, recorded_by, proof_path)
  values (ws, doc, how, amount, coalesce(on_date, (now() at time zone 'Africa/Johannesburg')::date), p_ref, p_provider_ref, actor, proof)
  on conflict (method, provider_ref) do nothing
  returning id into pay_id;
  if pay_id is null then
    return jsonb_build_object('applied', false, 'duplicate', true);
  end if;

  update public.sales_documents
  set paid_cents = paid_cents + amount,
      status = case when total_cents - (paid_cents + amount) - credited_cents <= 0 then 'paid' else 'part_paid' end
  where id = doc;

  insert into public.activities (workspace_id, contact_id, kind, ref_id, summary, actor_id)
  values (ws, d.contact_id, 'payment_received', pay_id,
          left('Payment received for ' || d.number || ' (' || how || ')', 300), actor);
  perform app.award_xp(ws, actor, 'payment_received', pay_id::text);

  return jsonb_build_object('applied', true, 'duplicate', false, 'payment_id', pay_id, 'first', first_payment);
end;
$$;
revoke all on function app.apply_payment(uuid, uuid, text, bigint, date, text, text, uuid, text) from public, anon, authenticated;

/** EFT, cash or card-machine payments typed in by the business. One per button press (p_request). */
create or replace function public.record_manual_payment(p_doc uuid, p_amount_cents bigint, p_method text,
                                                        p_paid_on date, p_reference text, p_proof_path text, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.sales_documents where id = p_doc;
  if ws is null or not app.has_role(ws, array['owner', 'admin', 'staff']) then
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
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> ws::text then
    raise exception 'That proof of payment belongs elsewhere' using errcode = 'LDG03';
  end if;
  return app.apply_payment(ws, p_doc, p_method, p_amount_cents, p_paid_on, left(nullif(btrim(p_reference), ''), 120),
                           'manual:' || p_request, (select auth.uid()), p_proof_path);
end;
$$;
revoke all on function public.record_manual_payment(uuid, bigint, text, date, text, text, uuid) from public, anon;
grant execute on function public.record_manual_payment(uuid, bigint, text, date, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Connecting a provider (owner or admin). Secrets go straight into Vault.
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

  update public.payment_connections set status = 'disabled'
  where workspace_id = p_workspace and provider = p_provider and status = 'active';

  secret_ref := vault.create_secret(p_secret, 'pay:' || gen_random_uuid(), p_provider || ' secret for workspace ' || p_workspace);
  if coalesce(btrim(p_passphrase), '') <> '' then
    pass_ref := vault.create_secret(btrim(p_passphrase), 'pay:' || gen_random_uuid(), 'payfast passphrase for workspace ' || p_workspace);
  end if;

  insert into public.payment_connections (workspace_id, provider, mode, merchant_id, secret_id, passphrase_id, created_by)
  values (p_workspace, p_provider, p_mode, case when p_provider = 'payfast' then p_merchant_id end, secret_ref, pass_ref, (select auth.uid()))
  returning id into conn;

  perform app.complete_quest_step(p_workspace, 'get_paid_setup');
  return conn;
end;
$$;
revoke all on function public.connect_payment_provider(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.connect_payment_provider(uuid, text, text, text, text, text) to authenticated;

/** After registering the Yoco webhook, store its id and signing secret on the connection. */
create or replace function public.attach_yoco_webhook(p_connection uuid, p_webhook_id text, p_webhook_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.payment_connections%rowtype;
begin
  select * into c from public.payment_connections where id = p_connection and provider = 'yoco' and status = 'active';
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin']) then
    raise exception 'Connection not found' using errcode = 'no_data_found';
  end if;
  if coalesce(p_webhook_secret, '') !~ '^whsec_[A-Za-z0-9+/=]{16,200}$' then
    raise exception 'Unexpected webhook secret from Yoco' using errcode = 'LDG03';
  end if;
  update public.payment_connections
  set webhook_id = left(p_webhook_id, 100),
      webhook_secret_id = vault.create_secret(p_webhook_secret, 'pay:' || gen_random_uuid(), 'yoco webhook secret for workspace ' || c.workspace_id)
  where id = c.id;
end;
$$;
revoke all on function public.attach_yoco_webhook(uuid, text, text) from public, anon;
grant execute on function public.attach_yoco_webhook(uuid, text, text) to authenticated;

create or replace function public.disconnect_payment_provider(p_connection uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.payment_connections%rowtype;
begin
  select * into c from public.payment_connections where id = p_connection;
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin']) then
    raise exception 'Connection not found' using errcode = 'no_data_found';
  end if;
  update public.payment_connections set status = 'disabled' where id = c.id;
  delete from vault.secrets where id in (c.secret_id, c.passphrase_id, c.webhook_secret_id);
end;
$$;
revoke all on function public.disconnect_payment_provider(uuid) from public, anon;
grant execute on function public.disconnect_payment_provider(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Server-only (service role): secrets for checkout and webhook verification,
-- and applying a verified provider notification.
-- ---------------------------------------------------------------------------
create or replace function public.payment_connection_secrets(p_connection uuid)
returns table (workspace_id uuid, provider text, mode text, merchant_id text, status text,
               secret text, passphrase text, webhook_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.workspace_id, c.provider, c.mode, c.merchant_id, c.status,
         (select decrypted_secret from vault.decrypted_secrets where id = c.secret_id),
         (select decrypted_secret from vault.decrypted_secrets where id = c.passphrase_id),
         (select decrypted_secret from vault.decrypted_secrets where id = c.webhook_secret_id)
  from public.payment_connections c where c.id = p_connection;
$$;

/**
 * A notification that has already passed signature checks. Recorded once per (provider, event);
 * applied only if it matches a checkout we created, on this connection, for this exact amount.
 */
create or replace function public.apply_payment_event(p_connection uuid, p_provider text, p_event_id text,
                                                      p_checkout uuid, p_amount_cents bigint, p_provider_ref text,
                                                      p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.payment_connections%rowtype;
  co public.payment_checkouts%rowtype;
  event_row uuid;
  result jsonb;
  v_outcome text;
begin
  select * into c from public.payment_connections where id = p_connection and provider = p_provider;
  insert into public.payment_events (provider, event_id, workspace_id, connection_id, payload, outcome)
  values (p_provider, p_event_id, c.workspace_id, p_connection, coalesce(p_payload, '{}'::jsonb), 'received')
  on conflict (provider, event_id) do nothing
  returning id into event_row;
  if event_row is null then
    return 'duplicate';
  end if;

  select * into co from public.payment_checkouts where id = p_checkout for update;
  if c.id is null then
    v_outcome := 'rejected: unknown connection';
  elsif co.id is null then
    v_outcome := 'rejected: unknown checkout';
  elsif co.connection_id <> c.id or co.workspace_id <> c.workspace_id or co.provider <> p_provider then
    v_outcome := 'rejected: checkout belongs to another connection';
  elsif co.amount_cents <> p_amount_cents then
    v_outcome := 'rejected: amount ' || p_amount_cents || ' does not match ' || co.amount_cents;
  else
    begin
      result := app.apply_payment(co.workspace_id, co.document_id, p_provider, p_amount_cents, null,
                                  null, p_provider_ref, null, null);
      update public.payment_checkouts set status = 'paid' where id = co.id;
      v_outcome := case when (result ->> 'duplicate')::boolean then 'duplicate payment' else 'applied' end;
    exception when others then
      v_outcome := left('rejected: ' || sqlerrm, 200);
    end;
  end if;

  update public.payment_events set outcome = v_outcome where id = event_row;
  return v_outcome;
end;
$$;

revoke all on function public.payment_connection_secrets(uuid) from public, anon, authenticated;
revoke all on function public.apply_payment_event(uuid, text, text, uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_connection_secrets(uuid) to service_role;
grant execute on function public.apply_payment_event(uuid, text, text, uuid, bigint, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.payment_connections enable row level security;
alter table public.payment_checkouts enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
revoke all on public.payment_connections, public.payment_checkouts, public.payments, public.payment_events from anon, authenticated;

grant select (id, workspace_id, provider, mode, merchant_id, webhook_id, status, created_at)
  on public.payment_connections to authenticated;
grant select on public.payment_checkouts to authenticated;
grant select on public.payments to authenticated;

create policy payment_connections_select on public.payment_connections for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy payment_checkouts_select on public.payment_checkouts for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy payments_select on public.payments for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy payment_events_no_direct_access on public.payment_events
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------------
-- Proof of payment files: private bucket, one folder per workspace.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy payment_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs'
         and (select app.is_member(((storage.foldername(name))[1])::uuid)));
create policy payment_proofs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs'
              and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
              and (select app.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'staff'])));
