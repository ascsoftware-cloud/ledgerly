-- 0050_integrations: the shared plumbing for outside services (Courier Guy, Shopify, Xero, Sage).
-- Payment providers stay in payment_connections; Stitch joins them in 0051.
-- Down script: supabase/migrations/down/0050_integrations.sql
--
-- Numbered 0050+ so it does not collide with Phases 4–7. Renumber to the next free number
-- if those phases have not landed when this merges.
--
-- Rules the database enforces:
--  * Credentials live in Vault. Tables hold only Vault ids; only the service role can read them.
--  * One live connection per provider per workspace, and one Shopify store per workspace.
--  * Outside calls happen in a queue (integration_jobs). The same intent twice is one job.
--  * Only one worker refreshes an OAuth token at a time (a 60-second lease), because Xero and
--    Shopify retire the old refresh token when a new one is issued.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('courier_guy', 'shopify', 'xero', 'sage_za')),
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'disabled')),
  mode text not null default 'live' check (mode in ('test', 'live')),
  -- Shopify: shop domain. Xero: tenant id. Sage: company id.
  external_id text check (char_length(external_id) <= 200),
  external_name text check (char_length(external_name) <= 200),
  -- Non-secret settings: account mappings, Courier Guy base URL and collection address.
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  -- Vault ids. Courier Guy: API key. Shopify/Xero: access token (+ refresh token). Sage: password.
  secret_id uuid,
  refresh_id uuid,
  token_expires_at timestamptz,
  refresh_lease_until timestamptz,
  last_sync_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (provider <> 'shopify' or external_id ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$')
);
create unique index integration_connections_one_live on public.integration_connections (workspace_id, provider)
  where status <> 'disabled';
-- Shopify webhooks arrive per shop: each shop must map to exactly one workspace.
create unique index integration_connections_one_shop on public.integration_connections (external_id)
  where provider = 'shopify' and status <> 'disabled';
create index integration_connections_created_by_idx on public.integration_connections (created_by);

create trigger touch_integration_connections before update on public.integration_connections
  for each row execute function app.touch_updated_at();

create table public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  connection_id uuid not null,
  kind text not null check (kind in ('push_document', 'void_document', 'push_payment',
                                     'shopify_sync', 'shopify_refresh', 'track_shipment')),
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 8192),
  -- One row per intent: the same key twice is the same job.
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 300),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (workspace_id, connection_id) references public.integration_connections (workspace_id, id) on delete cascade
);
create index integration_jobs_due_idx on public.integration_jobs (next_attempt_at) where status = 'pending';
create index integration_jobs_conn_idx on public.integration_jobs (workspace_id, connection_id, created_at desc);
create index integration_jobs_entity_idx on public.integration_jobs (workspace_id, entity_id) where entity_id is not null;

-- What we created on the other side, so a retry updates instead of duplicating.
create table public.sync_links (
  workspace_id uuid not null,
  connection_id uuid not null,
  entity_type text not null check (entity_type in ('contact', 'document', 'payment')),
  local_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  external_number text check (char_length(external_number) <= 100),
  -- Totals as the other side reported them, in cents, so a rounding difference is visible.
  external_total_cents bigint,
  mismatch boolean not null default false,
  synced_at timestamptz not null default now(),
  primary key (connection_id, entity_type, local_id),
  foreign key (workspace_id, connection_id) references public.integration_connections (workspace_id, id) on delete cascade
);
create index sync_links_ws_idx on public.sync_links (workspace_id, entity_type, local_id);

-- Incoming webhook deliveries (Shopify), each recorded once.
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('courier_guy', 'shopify', 'xero', 'sage_za')),
  event_id text not null check (char_length(event_id) between 1 and 200),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  topic text check (char_length(topic) <= 100),
  outcome text not null check (char_length(outcome) <= 200),
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
create index integration_events_ws_idx on public.integration_events (workspace_id, received_at desc);

-- ---------------------------------------------------------------------------
-- Connecting and disconnecting (owner or admin, as themselves)
-- ---------------------------------------------------------------------------
create or replace function app.drop_integration_secrets(c public.integration_connections)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where id in (c.secret_id, c.refresh_id);
$$;
revoke all on function app.drop_integration_secrets(public.integration_connections) from public, anon, authenticated;

/**
 * Stores a new connection and its credentials. Any earlier connection to the same provider in
 * this workspace is switched off and its credentials deleted. p_expires_in is the access
 * token lifetime in seconds (OAuth providers) or null. Callers check who is asking first.
 */
create or replace function app.connect_integration_core(p_workspace uuid, p_actor uuid, p_provider text, p_mode text,
                                                        p_external_id text, p_external_name text, p_settings jsonb,
                                                        p_secret text, p_refresh text, p_expires_in integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row public.integration_connections%rowtype;
  conn uuid;
  secret_ref uuid;
  refresh_ref uuid;
  ext text := nullif(lower(btrim(coalesce(p_external_id, ''))), '');
begin
  if p_provider not in ('courier_guy', 'shopify', 'xero', 'sage_za') or coalesce(p_mode, 'live') not in ('test', 'live') then
    raise exception 'Unknown app or mode' using errcode = 'LDG03';
  end if;
  if coalesce(btrim(p_secret), '') = '' or char_length(p_secret) > 4000 or char_length(coalesce(p_refresh, '')) > 4000 then
    raise exception 'The connection details are missing or too long' using errcode = 'LDG03';
  end if;
  if p_provider = 'shopify' and coalesce(ext, '') !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' then
    raise exception 'That is not a myshopify.com store address' using errcode = 'LDG03';
  end if;
  if p_provider in ('xero', 'sage_za') and ext is null then
    raise exception 'Choose which organisation to connect' using errcode = 'LDG03';
  end if;
  if p_settings is not null and jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Settings must be an object' using errcode = 'LDG03';
  end if;
  if p_provider = 'shopify' and exists (
    select 1 from public.integration_connections
    where provider = 'shopify' and external_id = ext and status <> 'disabled' and workspace_id <> p_workspace
  ) then
    raise exception 'That Shopify store is already connected to another Ledgerly workspace' using errcode = 'LDG03';
  end if;

  for old_row in
    select * from public.integration_connections
    where workspace_id = p_workspace and provider = p_provider and status <> 'disabled'
    for update
  loop
    perform app.drop_integration_secrets(old_row);
    update public.integration_connections set status = 'disabled', secret_id = null, refresh_id = null where id = old_row.id;
    update public.integration_jobs set status = 'cancelled', finished_at = now()
    where connection_id = old_row.id and status in ('pending', 'running');
  end loop;

  secret_ref := vault.create_secret(p_secret, 'int:' || gen_random_uuid(), p_provider || ' credential for workspace ' || p_workspace);
  if coalesce(p_refresh, '') <> '' then
    refresh_ref := vault.create_secret(p_refresh, 'int:' || gen_random_uuid(), p_provider || ' refresh token for workspace ' || p_workspace);
  end if;

  insert into public.integration_connections (workspace_id, provider, mode, external_id, external_name, settings,
                                              secret_id, refresh_id, token_expires_at, created_by)
  values (p_workspace, p_provider, coalesce(p_mode, 'live'), ext, left(nullif(btrim(p_external_name), ''), 200),
          coalesce(p_settings, '{}'::jsonb), secret_ref, refresh_ref,
          case when p_expires_in is not null then now() + make_interval(secs => greatest(p_expires_in, 0)) end,
          p_actor)
  returning id into conn;

  -- Reconnecting to the same organisation or store: keep what was already sent, so nothing is
  -- created twice in Xero or Sage, and move queued or stuck work to the new connection.
  if ext is not null then
    insert into public.sync_links (workspace_id, connection_id, entity_type, local_id, external_id, external_number,
                                   external_total_cents, mismatch, synced_at)
    select l.workspace_id, conn, l.entity_type, l.local_id, l.external_id, l.external_number, l.external_total_cents,
           l.mismatch, l.synced_at
    from public.sync_links l
    join public.integration_connections o on o.id = l.connection_id
    where o.workspace_id = p_workspace and o.provider = p_provider and o.external_id = ext and o.id <> conn
    on conflict (connection_id, entity_type, local_id) do nothing;
    update public.integration_jobs j
    set connection_id = conn, status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, finished_at = null
    from public.integration_connections o
    where j.connection_id = o.id and o.workspace_id = p_workspace and o.provider = p_provider and o.external_id = ext
      and o.id <> conn and j.kind in ('push_document', 'void_document', 'push_payment')
      and (j.status = 'failed' or (j.status = 'cancelled' and j.finished_at > now() - interval '1 minute'));
  end if;
  return conn;
end;
$$;
revoke all on function app.connect_integration_core(uuid, uuid, text, text, text, text, jsonb, text, text, integer) from public, anon, authenticated;

/** Connecting an app as the signed-in owner or admin. */
create or replace function public.connect_integration(p_workspace uuid, p_provider text, p_mode text,
                                                      p_external_id text, p_external_name text, p_settings jsonb,
                                                      p_secret text, p_refresh text, p_expires_in integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_role(p_workspace, array['owner', 'admin']) then
    raise exception 'Only owners and admins can connect apps' using errcode = 'insufficient_privilege';
  end if;
  -- A Shopify store is claimed only after Shopify's own OAuth proves control of it (connect_shopify),
  -- so nobody can squat on someone else's store address.
  if p_provider = 'shopify' then
    raise exception 'Connect Shopify with the Connect button' using errcode = 'LDG03';
  end if;
  return app.connect_integration_core(p_workspace, (select auth.uid()), p_provider, p_mode, p_external_id, p_external_name,
                                      p_settings, p_secret, p_refresh, p_expires_in);
end;
$$;
revoke all on function public.connect_integration(uuid, text, text, text, text, jsonb, text, text, integer) from public, anon;
grant execute on function public.connect_integration(uuid, text, text, text, text, jsonb, text, text, integer) to authenticated;

/**
 * Server only: saves a Shopify store after Shopify's OAuth callback was verified, for a person
 * the server has confirmed is signed in. Their role is checked here, from the membership table.
 */
create or replace function public.connect_shopify(p_workspace uuid, p_actor uuid, p_shop text, p_name text, p_settings jsonb,
                                                  p_access text, p_refresh text, p_expires_in integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships m join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = p_workspace and m.user_id = p_actor and m.role in ('owner', 'admin') and w.deleted_at is null
  ) then
    raise exception 'Only owners and admins can connect apps' using errcode = 'insufficient_privilege';
  end if;
  return app.connect_integration_core(p_workspace, p_actor, 'shopify', 'live', p_shop, p_name, p_settings,
                                      p_access, p_refresh, p_expires_in);
end;
$$;
revoke all on function public.connect_shopify(uuid, uuid, text, text, jsonb, text, text, integer) from public, anon, authenticated;
grant execute on function public.connect_shopify(uuid, uuid, text, text, jsonb, text, text, integer) to service_role;

/** Replaces the non-secret settings (mappings, addresses). Keys starting with "_" are reserved. */
create or replace function public.update_integration_settings(p_connection uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.integration_connections%rowtype;
begin
  select * into c from public.integration_connections where id = p_connection and status <> 'disabled';
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin']) then
    raise exception 'Connection not found' using errcode = 'no_data_found';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or pg_column_size(p_settings) > 16000 then
    raise exception 'Those settings are not valid' using errcode = 'LDG03';
  end if;
  update public.integration_connections
  set settings = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(c.settings) where key like '\_%')
                 || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(p_settings) where key not like '\_%')
  where id = c.id;
end;
$$;
revoke all on function public.update_integration_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_integration_settings(uuid, jsonb) to authenticated;

create or replace function public.disconnect_integration(p_connection uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.integration_connections%rowtype;
begin
  select * into c from public.integration_connections where id = p_connection for update;
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin']) then
    raise exception 'Connection not found' using errcode = 'no_data_found';
  end if;
  perform app.drop_integration_secrets(c);
  update public.integration_connections set status = 'disabled', secret_id = null, refresh_id = null where id = c.id;
  update public.integration_jobs set status = 'cancelled', finished_at = now()
  where connection_id = c.id and status in ('pending', 'running');
end;
$$;
revoke all on function public.disconnect_integration(uuid) from public, anon;
grant execute on function public.disconnect_integration(uuid) to authenticated;

/** Puts a failed job back in the queue (the "Try again" button). */
create or replace function public.retry_integration_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.integration_jobs%rowtype;
begin
  select * into j from public.integration_jobs where id = p_job for update;
  if not found or not app.has_role(j.workspace_id, array['owner', 'admin']) then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;
  if j.status <> 'failed' then
    return;
  end if;
  if not exists (select 1 from public.integration_connections where id = j.connection_id and status = 'active') then
    raise exception 'Reconnect the app first' using errcode = 'LDG03';
  end if;
  update public.integration_jobs set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, finished_at = null
  where id = j.id;
end;
$$;
revoke all on function public.retry_integration_job(uuid) from public, anon;
grant execute on function public.retry_integration_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Server only (service role)
-- ---------------------------------------------------------------------------
create or replace function public.integration_secrets(p_connection uuid)
returns table (id uuid, workspace_id uuid, provider text, status text, mode text, external_id text, external_name text,
               settings jsonb, secret text, refresh text, token_expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.workspace_id, c.provider, c.status, c.mode, c.external_id, c.external_name, c.settings,
         (select decrypted_secret from vault.decrypted_secrets where id = c.secret_id),
         (select decrypted_secret from vault.decrypted_secrets where id = c.refresh_id),
         c.token_expires_at
  from public.integration_connections c where c.id = p_connection;
$$;

/** Takes the right to refresh this connection's token for 60 seconds. False if someone else has it. */
create or replace function public.claim_token_refresh(p_connection uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with t as (
    update public.integration_connections
    set refresh_lease_until = now() + interval '60 seconds'
    where id = p_connection and status = 'active'
      and (refresh_lease_until is null or refresh_lease_until < now())
    returning 1
  )
  select exists (select 1 from t);
$$;

/** Saves newly issued tokens (the refresh token may be rotated) and releases the lease. */
create or replace function public.store_integration_tokens(p_connection uuid, p_secret text, p_refresh text, p_expires_in integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.integration_connections%rowtype;
begin
  select * into c from public.integration_connections where id = p_connection and status <> 'disabled' for update;
  if not found then
    return;
  end if;
  if coalesce(p_secret, '') <> '' then
    if c.secret_id is null then
      update public.integration_connections
      set secret_id = vault.create_secret(p_secret, 'int:' || gen_random_uuid(), c.provider || ' credential for workspace ' || c.workspace_id)
      where id = c.id;
    else
      perform vault.update_secret(c.secret_id, p_secret);
    end if;
  end if;
  if coalesce(p_refresh, '') <> '' then
    if c.refresh_id is null then
      update public.integration_connections
      set refresh_id = vault.create_secret(p_refresh, 'int:' || gen_random_uuid(), c.provider || ' refresh token for workspace ' || c.workspace_id)
      where id = c.id;
    else
      perform vault.update_secret(c.refresh_id, p_refresh);
    end if;
  end if;
  update public.integration_connections
  set token_expires_at = case when p_expires_in is not null then now() + make_interval(secs => greatest(p_expires_in, 0)) else token_expires_at end,
      refresh_lease_until = null,
      status = 'active',
      last_error = null
  where id = c.id;
end;
$$;

/** Switches a connection off from the server side (app uninstalled, store erased): credentials go too. */
create or replace function public.disable_integration(p_connection uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.integration_connections%rowtype;
begin
  select * into c from public.integration_connections where id = p_connection for update;
  if not found then
    return;
  end if;
  perform app.drop_integration_secrets(c);
  update public.integration_connections
  set status = 'disabled', secret_id = null, refresh_id = null, last_error = left(p_reason, 500)
  where id = c.id;
  update public.integration_jobs set status = 'cancelled', finished_at = now()
  where connection_id = c.id and status in ('pending', 'running');
end;
$$;

/** Records how a connection is doing: a failure note, "needs_reauth", or a successful sync time. */
create or replace function public.mark_integration(p_connection uuid, p_status text, p_error text, p_synced boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.integration_connections
  set status = case when status = 'disabled' then status
                    when p_status in ('active', 'needs_reauth', 'disabled') then p_status else status end,
      last_error = left(p_error, 500),
      last_sync_at = case when p_synced then now() else last_sync_at end,
      refresh_lease_until = null
  where id = p_connection;
$$;

/** Adds a job unless the same intent is already queued. Returns the job id either way. */
create or replace function public.enqueue_integration_job(p_connection uuid, p_kind text, p_entity uuid, p_payload jsonb,
                                                          p_dedupe text, p_delay_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.integration_connections%rowtype;
  job uuid;
begin
  select * into c from public.integration_connections where id = p_connection and status = 'active';
  if not found then
    return null;
  end if;
  insert into public.integration_jobs (workspace_id, connection_id, kind, entity_id, payload, dedupe_key, next_attempt_at)
  values (c.workspace_id, c.id, p_kind, p_entity, coalesce(p_payload, '{}'::jsonb), p_dedupe,
          now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0)))
  on conflict (dedupe_key) do update
    -- A finished sync or refresh can run again later; a pushed document is never pushed twice by the queue.
    set status = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at, payload = excluded.payload,
        last_error = null, finished_at = null
    where public.integration_jobs.status in ('done', 'cancelled')
      and public.integration_jobs.kind in ('shopify_sync', 'shopify_refresh', 'track_shipment')
  returning id into job;
  if job is null then
    select id into job from public.integration_jobs where dedupe_key = p_dedupe;
  end if;
  return job;
end;
$$;

/** Worker only: takes up to `p_limit` due jobs, so two workers never take the same one. */
create or replace function public.claim_integration_jobs(p_limit integer)
returns setof public.integration_jobs
language sql
security definer
set search_path = ''
as $$
  update public.integration_jobs j
  -- next_attempt_at becomes the claim time, so a worker that dies is noticed 10 minutes later.
  set status = 'running', attempts = j.attempts + 1, next_attempt_at = now()
  where j.id in (
    select ij.id from public.integration_jobs ij
    join public.integration_connections c on c.id = ij.connection_id and c.status = 'active'
    where ij.status = 'pending' and ij.next_attempt_at <= now()
    order by ij.next_attempt_at
    limit least(greatest(p_limit, 1), 25)
    for update of ij skip locked
  )
  returning j.*;
$$;

/**
 * Worker only: records the result.
 *  ok, no p_retry_in        -> done.
 *  ok, p_retry_in seconds   -> a batch that wants to continue: queued again, attempts reset.
 *  failed, p_retry_in = 0   -> stop now: something the person must fix (a mapping, a reconnect).
 *  failed, p_retry_in > 0   -> retry at that time (a 429's Retry-After), still counting attempts.
 *  failed, no p_retry_in    -> retry after 1, 2, 4 … 64 minutes; after 8 attempts it stops.
 * Stopped jobs show on the integrations page with a "Try again" button.
 */
create or replace function public.finish_integration_job(p_id uuid, p_ok boolean, p_error text, p_retry_in integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.integration_jobs
  set status = case when p_ok and p_retry_in is null then 'done'
                    when p_ok then 'pending'
                    when p_retry_in = 0 or attempts >= 8 then 'failed'
                    else 'pending' end,
      attempts = case when p_ok and p_retry_in is not null then 0 else attempts end,
      finished_at = case when (p_ok and p_retry_in is null) or (not p_ok and (p_retry_in = 0 or attempts >= 8)) then now() end,
      last_error = case when p_ok then null else left(p_error, 500) end,
      next_attempt_at = case when p_ok and p_retry_in is null then next_attempt_at
                             when p_retry_in is not null then now() + make_interval(secs => least(greatest(p_retry_in, 1), 3600))
                             else now() + make_interval(mins => power(2, least(greatest(attempts - 1, 0), 6))::int) end
  where id = p_id and status = 'running';
$$;

/** Jobs stuck in "running" (a worker died) go back to the queue after 10 minutes. */
create or replace function public.release_stuck_integration_jobs()
returns integer
language sql
security definer
set search_path = ''
as $$
  with r as (
    update public.integration_jobs set status = 'pending', next_attempt_at = now()
    where status = 'running' and next_attempt_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::int from r;
$$;

/** Remembers what a local record became on the other side. */
create or replace function public.save_sync_link(p_connection uuid, p_entity_type text, p_local uuid, p_external text,
                                                 p_number text, p_external_total bigint, p_local_total bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_links (workspace_id, connection_id, entity_type, local_id, external_id, external_number,
                                 external_total_cents, mismatch)
  select c.workspace_id, c.id, p_entity_type, p_local, p_external, left(p_number, 100), p_external_total,
         p_external_total is not null and p_local_total is not null and p_external_total <> p_local_total
  from public.integration_connections c where c.id = p_connection
  on conflict (connection_id, entity_type, local_id) do update
    set external_id = excluded.external_id,
        external_number = coalesce(excluded.external_number, public.sync_links.external_number),
        external_total_cents = coalesce(excluded.external_total_cents, public.sync_links.external_total_cents),
        mismatch = excluded.mismatch or (excluded.external_total_cents is null and public.sync_links.mismatch),
        synced_at = now();
$$;

/** Records a webhook delivery once. Returns false when it was seen before. */
create or replace function public.record_integration_event(p_provider text, p_event_id text, p_workspace uuid,
                                                           p_topic text, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id uuid;
begin
  insert into public.integration_events (provider, event_id, workspace_id, topic, outcome)
  values (p_provider, left(p_event_id, 200), p_workspace, left(p_topic, 100), left(coalesce(p_outcome, 'received'), 200))
  on conflict (provider, event_id) do nothing
  returning id into row_id;
  return row_id is not null;
end;
$$;

revoke all on function public.integration_secrets(uuid) from public, anon, authenticated;
revoke all on function public.claim_token_refresh(uuid) from public, anon, authenticated;
revoke all on function public.store_integration_tokens(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.mark_integration(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.disable_integration(uuid, text) from public, anon, authenticated;
revoke all on function public.enqueue_integration_job(uuid, text, uuid, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.claim_integration_jobs(integer) from public, anon, authenticated;
revoke all on function public.finish_integration_job(uuid, boolean, text, integer) from public, anon, authenticated;
revoke all on function public.release_stuck_integration_jobs() from public, anon, authenticated;
revoke all on function public.save_sync_link(uuid, text, uuid, text, text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.record_integration_event(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.integration_secrets(uuid) to service_role;
grant execute on function public.claim_token_refresh(uuid) to service_role;
grant execute on function public.store_integration_tokens(uuid, text, text, integer) to service_role;
grant execute on function public.mark_integration(uuid, text, text, boolean) to service_role;
grant execute on function public.disable_integration(uuid, text) to service_role;
grant execute on function public.enqueue_integration_job(uuid, text, uuid, jsonb, text, integer) to service_role;
grant execute on function public.claim_integration_jobs(integer) to service_role;
grant execute on function public.finish_integration_job(uuid, boolean, text, integer) to service_role;
grant execute on function public.release_stuck_integration_jobs() to service_role;
grant execute on function public.save_sync_link(uuid, text, uuid, text, text, bigint, bigint) to service_role;
grant execute on function public.record_integration_event(text, text, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Credentials never outlive their connection (POPIA), including on workspace delete.
-- ---------------------------------------------------------------------------
create or replace function app.purge_integration_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id in (old.secret_id, old.refresh_id);
  return old;
end;
$$;
revoke all on function app.purge_integration_secrets() from public, anon, authenticated;

create trigger purge_integration_secrets after delete on public.integration_connections
  for each row execute function app.purge_integration_secrets();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.integration_connections enable row level security;
alter table public.integration_jobs enable row level security;
alter table public.sync_links enable row level security;
alter table public.integration_events enable row level security;
revoke all on public.integration_connections, public.integration_jobs, public.sync_links, public.integration_events
  from anon, authenticated;

-- Members see which apps are connected (to show "In Xero", the Shop page and so on); never the Vault ids.
grant select (id, workspace_id, provider, status, mode, external_id, external_name, settings, last_sync_at, last_error,
              created_at, updated_at)
  on public.integration_connections to authenticated;
grant select (id, workspace_id, connection_id, kind, entity_id, status, attempts, next_attempt_at, last_error, created_at,
              finished_at)
  on public.integration_jobs to authenticated;
grant select on public.sync_links to authenticated;

create policy integration_connections_select on public.integration_connections for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy integration_jobs_select on public.integration_jobs for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'accountant'])));
create policy sync_links_select on public.sync_links for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy integration_events_no_direct_access on public.integration_events
  as restrictive for all to anon, authenticated using (false) with check (false);
