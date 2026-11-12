-- 0051_stitch: Stitch (pay by bank, Capitec Pay, card) as a third payment provider, next to Yoco
-- and PayFast. Same rules: each business connects its own Stitch client, secrets stay in Vault,
-- a payment is applied once per Stitch payment request id.
-- Down script: supabase/migrations/down/0051_stitch.sql

alter table public.payment_connections drop constraint payment_connections_provider_check,
  add constraint payment_connections_provider_check check (provider in ('yoco', 'payfast', 'stitch'));
alter table public.payment_checkouts drop constraint payment_checkouts_provider_check,
  add constraint payment_checkouts_provider_check check (provider in ('yoco', 'payfast', 'stitch'));
alter table public.payment_events drop constraint payment_events_provider_check,
  add constraint payment_events_provider_check check (provider in ('yoco', 'payfast', 'stitch'));
alter table public.payments drop constraint payments_method_check,
  add constraint payments_method_check check (method in ('yoco', 'payfast', 'stitch', 'eft', 'cash', 'card', 'other'));

-- Stitch client ids are not PayFast-style numbers, so they get their own column.
alter table public.payment_connections
  add column client_id text check (client_id ~ '^[A-Za-z0-9._-]{8,100}$'),
  add constraint payment_connections_stitch_client check (provider <> 'stitch' or client_id is not null);

grant select (client_id) on public.payment_connections to authenticated;

/**
 * Connects Stitch for one business (owner or admin). The webhook signing secret is optional:
 * without it, payments are still confirmed when the payer returns, by asking Stitch directly.
 */
create or replace function public.connect_stitch(p_workspace uuid, p_mode text, p_client_id text, p_client_secret text,
                                                 p_webhook_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  conn uuid;
  old_row public.payment_connections%rowtype;
  secret_ref uuid;
  hook_ref uuid;
begin
  if not app.has_role(p_workspace, array['owner', 'admin']) then
    raise exception 'Only owners and admins can connect payments' using errcode = 'insufficient_privilege';
  end if;
  if p_mode not in ('test', 'live') then
    raise exception 'Unknown mode' using errcode = 'LDG03';
  end if;
  if coalesce(btrim(p_client_id), '') !~ '^[A-Za-z0-9._-]{8,100}$' then
    raise exception 'Check the Stitch client ID' using errcode = 'LDG03';
  end if;
  if char_length(coalesce(p_client_secret, '')) not between 16 and 500 or p_client_secret ~ '\s' then
    raise exception 'Check the Stitch client secret' using errcode = 'LDG03';
  end if;
  if coalesce(btrim(p_webhook_secret), '') <> '' and btrim(p_webhook_secret) !~ '^whsec_[A-Za-z0-9+/=]{16,200}$' then
    raise exception 'The webhook signing secret starts with whsec_' using errcode = 'LDG03';
  end if;

  for old_row in
    select * from public.payment_connections
    where workspace_id = p_workspace and provider = 'stitch' and status = 'active'
    for update
  loop
    update public.payment_connections set status = 'disabled' where id = old_row.id;
    delete from vault.secrets where id in (old_row.secret_id, old_row.passphrase_id, old_row.webhook_secret_id);
  end loop;

  secret_ref := vault.create_secret(p_client_secret, 'pay:' || gen_random_uuid(), 'stitch secret for workspace ' || p_workspace);
  if coalesce(btrim(p_webhook_secret), '') <> '' then
    hook_ref := vault.create_secret(btrim(p_webhook_secret), 'pay:' || gen_random_uuid(), 'stitch webhook secret for workspace ' || p_workspace);
  end if;

  insert into public.payment_connections (workspace_id, provider, mode, client_id, secret_id, webhook_secret_id, created_by)
  values (p_workspace, 'stitch', p_mode, btrim(p_client_id), secret_ref, hook_ref, (select auth.uid()))
  returning id into conn;

  perform app.complete_quest_step(p_workspace, 'get_paid_setup');
  return conn;
end;
$$;
revoke all on function public.connect_stitch(uuid, text, text, text, text) from public, anon;
grant execute on function public.connect_stitch(uuid, text, text, text, text) to authenticated;

/** Server only: the Stitch client credentials for one connection. */
create or replace function public.stitch_connection_secrets(p_connection uuid)
returns table (workspace_id uuid, mode text, status text, client_id text, client_secret text, webhook_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.workspace_id, c.mode, c.status, c.client_id,
         (select decrypted_secret from vault.decrypted_secrets where id = c.secret_id),
         (select decrypted_secret from vault.decrypted_secrets where id = c.webhook_secret_id)
  from public.payment_connections c where c.id = p_connection and c.provider = 'stitch';
$$;
revoke all on function public.stitch_connection_secrets(uuid) from public, anon, authenticated;
grant execute on function public.stitch_connection_secrets(uuid) to service_role;

-- Same as 0019's remove_payment, with Stitch added: a payment Stitch confirmed is refunded with
-- Stitch, not deleted by hand. Keep in step with 0019 if that function changes.
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
  if p.method in ('yoco', 'payfast', 'stitch') then
    raise exception 'Payments confirmed by Yoco, PayFast or Stitch cannot be removed here. Refund them with the provider and issue a credit note.'
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
