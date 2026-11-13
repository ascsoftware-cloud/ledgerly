-- 0038_billing: Pro subscriptions (PayFast), and the plan limits that are database rules.
-- Down script: supabase/migrations/down/0038_billing.sql
--
-- Rules the database enforces:
--  * `workspaces.plan` changes only through the functions here, called by the server after a verified PayFast
--    notification (service_role). The same notification twice is one payment (billing_events).
--  * Cancelling keeps Pro until the paid period ends; a daily job then returns the workspace to Free.
--    Downgrading never hides or deletes data: limits only stop NEW sends, automations, portal links, uploads
--    past the storage cap and extra workspaces.
--  * Only owners can start or cancel a subscription, and only owners can read its status. The PayFast token is
--    never readable by signed-in people.
--  * Automations, new portal links and extra workspaces are Pro. (Documents: 0019; AI: 0034; storage: storage_room.)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  provider text not null default 'payfast' check (provider = 'payfast'),
  status text not null check (status in ('active', 'cancelling', 'cancelled')),
  token text check (char_length(token) <= 100),
  price_cents integer not null check (price_cents > 0),
  current_period_end timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);
create index billing_checkouts_ws_idx on public.billing_checkouts (workspace_id, created_at desc);
create index billing_checkouts_user_idx on public.billing_checkouts (user_id);

create table public.billing_events (
  pf_payment_id text primary key check (char_length(pf_payment_id) between 1 and 100),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  amount_cents integer not null,
  created_at timestamptz not null default now()
);
create index billing_events_ws_idx on public.billing_events (workspace_id, created_at desc);

alter table public.subscriptions enable row level security;
alter table public.billing_checkouts enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.subscriptions, public.billing_checkouts, public.billing_events from anon, authenticated;
-- Everything but the token.
grant select (workspace_id, provider, status, price_cents, current_period_end, cancelled_at, created_at) on public.subscriptions to authenticated;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using ((select app.has_role(workspace_id, array['owner'])));

-- ---------------------------------------------------------------------------
-- Server-only functions (service_role)
-- ---------------------------------------------------------------------------
-- A checkout for one owner to upgrade one workspace.
create function public.billing_start_checkout(p_workspace uuid, p_user uuid, p_amount_cents integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not exists (select 1 from public.memberships m where m.workspace_id = p_workspace and m.user_id = p_user and m.role = 'owner') then
    raise exception 'Only the owner can change the plan' using errcode = 'LDG03';
  end if;
  if exists (select 1 from public.subscriptions s where s.workspace_id = p_workspace and s.status = 'active') then
    raise exception 'This business is already on Pro' using errcode = 'LDG03';
  end if;
  insert into public.billing_checkouts (workspace_id, user_id, amount_cents) values (p_workspace, p_user, p_amount_cents) returning id into new_id;
  return new_id;
end;
$$;

-- A verified payment: Pro for one more month. `p_amount_cents` must be what the subscription costs.
-- Returns 'activated', 'extended', 'duplicate' or 'unknown'.
create function public.billing_apply_payment(p_checkout uuid, p_token text, p_pf_payment_id text, p_amount_cents integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  existing public.subscriptions%rowtype;
  checkout public.billing_checkouts%rowtype;
begin
  -- A recurring payment carries the token we stored; the first one carries our checkout.
  if p_token is not null then
    select * into existing from public.subscriptions where token = p_token;
    if found then
      ws := existing.workspace_id;
      if existing.price_cents <> p_amount_cents then
        raise exception 'Amount does not match the subscription' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  if ws is null and p_checkout is not null then
    select * into checkout from public.billing_checkouts where id = p_checkout;
    if found then
      ws := checkout.workspace_id;
      if checkout.amount_cents <> p_amount_cents then
        raise exception 'Amount does not match the checkout' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  if ws is null then
    return 'unknown';
  end if;
  perform pg_advisory_xact_lock(hashtext('billing:' || ws::text));
  insert into public.billing_events (pf_payment_id, workspace_id, amount_cents) values (p_pf_payment_id, ws, p_amount_cents)
  on conflict (pf_payment_id) do nothing;
  if not found then
    return 'duplicate';
  end if;
  select * into existing from public.subscriptions where workspace_id = ws;
  if found then
    update public.subscriptions
      set status = 'active', cancelled_at = null, token = coalesce(p_token, token), price_cents = p_amount_cents,
          current_period_end = greatest(now(), current_period_end) + interval '1 month', updated_at = now()
      where workspace_id = ws;
  else
    insert into public.subscriptions (workspace_id, status, token, price_cents, current_period_end)
    values (ws, 'active', p_token, p_amount_cents, now() + interval '1 month');
  end if;
  update public.workspaces set plan = 'pro' where id = ws;
  return case when existing.workspace_id is null then 'activated' else 'extended' end;
end;
$$;

-- Cancelled (by the owner here, or PayFast told us): Pro stays until the paid period ends.
create function public.billing_set_cancelling(p_workspace uuid, p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with hit as (
    update public.subscriptions
      set status = 'cancelling', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
      where status = 'active' and ((p_workspace is not null and workspace_id = p_workspace) or (p_token is not null and token = p_token))
      returning 1
  )
  select exists (select 1 from hit);
$$;

create function public.billing_get_token(p_workspace uuid, p_user uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select s.token from public.subscriptions s
  where s.workspace_id = p_workspace
    and exists (select 1 from public.memberships m where m.workspace_id = p_workspace and m.user_id = p_user and m.role = 'owner');
$$;

revoke all on function public.billing_start_checkout(uuid, uuid, integer), public.billing_apply_payment(uuid, text, text, integer),
  public.billing_set_cancelling(uuid, text), public.billing_get_token(uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_start_checkout(uuid, uuid, integer), public.billing_apply_payment(uuid, text, text, integer),
  public.billing_set_cancelling(uuid, text), public.billing_get_token(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The daily downgrade: a cancelled subscription whose paid period is over, or an active one whose payment has
-- not arrived for 3 days after it was due, returns to Free. Data stays.
-- ---------------------------------------------------------------------------
create function app.expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  with gone as (
    update public.subscriptions
      set status = 'cancelled', updated_at = now()
      where (status = 'cancelling' and current_period_end < now())
         or (status = 'active' and current_period_end < now() - interval '3 days')
      returning workspace_id
  )
  update public.workspaces w set plan = 'free' from gone where w.id = gone.workspace_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function app.expire_subscriptions() from public, anon, authenticated;
select cron.schedule('expire-subscriptions', '30 5 * * *', $cron$select app.expire_subscriptions()$cron$);

-- ---------------------------------------------------------------------------
-- Plan rules that are not documents or AI
-- ---------------------------------------------------------------------------
create function app.guard_rule_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select plan from public.workspaces where id = new.workspace_id) <> 'pro' then
    raise exception 'Automations are part of the Pro plan.' using errcode = 'LDG01';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_plan() from public, anon, authenticated;
create trigger guard_rule_plan before insert on public.automation_rules for each row execute function app.guard_rule_plan();

create function app.guard_portal_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select plan from public.workspaces where id = new.workspace_id) <> 'pro' then
    raise exception 'The customer portal is part of the Pro plan.' using errcode = 'LDG01';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_portal_plan() from public, anon, authenticated;
create trigger guard_portal_plan before insert on public.portal_links for each row execute function app.guard_portal_plan();

-- A Pro owner can make more businesses (each starts on Free). Free people have the one they were given.
create function public.create_additional_workspace(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  nm text := btrim(coalesce(p_name, ''));
  base text;
  ws_slug text;
  ws_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if char_length(nm) < 1 or char_length(nm) > 60 then
    raise exception 'Give the business a name of up to 60 characters.' using errcode = 'LDG03';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('provision:' || uid::text, 0));
  if not exists (
    select 1 from public.workspaces w join public.memberships m on m.workspace_id = w.id and m.user_id = uid and m.role = 'owner'
    where w.plan = 'pro' and w.deleted_at is null
  ) then
    raise exception 'More than one business is part of the Pro plan.' using errcode = 'LDG01';
  end if;
  if (select count(*) from public.workspaces w join public.memberships m on m.workspace_id = w.id and m.user_id = uid and m.role = 'owner' where w.deleted_at is null) >= 10 then
    raise exception 'You can own up to 10 businesses.' using errcode = 'LDG03';
  end if;
  base := left(regexp_replace(lower(nm), '[^a-z0-9]+', '', 'g'), 24);
  if char_length(base) < 2 then
    base := 'biz';
  end if;
  loop
    ws_slug := base || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
    exit when not exists (select 1 from public.workspaces w where w.slug = ws_slug);
  end loop;
  insert into public.workspaces (slug, name, created_by, needs_setup) values (ws_slug, nm, uid, false) returning id into ws_id;
  insert into public.memberships (workspace_id, user_id, role) values (ws_id, uid, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws_id);
  insert into public.workspace_modules (workspace_id, module) values (ws_id, 'invoices'), (ws_id, 'clients');
  insert into public.goals (workspace_id, kind, target_cents) values (ws_id, 'monthly_revenue', 1000000);
  insert into public.streaks (workspace_id, user_id) values (ws_id, uid);
  perform app.default_quest(ws_id);
  return jsonb_build_object('id', ws_id, 'slug', ws_slug);
end;
$$;
revoke all on function public.create_additional_workspace(text) from public, anon;
grant execute on function public.create_additional_workspace(text) to authenticated;

-- Storage: is there room for `p_bytes` more? (files under this workspace's folder in the three private buckets)
create function public.storage_room(p_workspace uuid, p_bytes bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  used bigint;
  lim bigint;
begin
  if not app.is_member(p_workspace) then
    raise exception 'Business not found' using errcode = 'no_data_found';
  end if;
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into used
  from storage.objects o
  where o.bucket_id in ('receipts', 'payment-proofs', 'documents') and split_part(o.name, '/', 1) = p_workspace::text;
  lim := case (select plan from public.workspaces where id = p_workspace) when 'pro' then 10000 else 200 end::bigint * 1024 * 1024;
  return used + greatest(p_bytes, 0) <= lim;
end;
$$;

-- What the plan page shows.
create function public.workspace_usage(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws_plan text;
  month_start timestamptz := date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
  used bigint;
begin
  if not app.is_member(p_workspace) then
    raise exception 'Business not found' using errcode = 'no_data_found';
  end if;
  select plan into ws_plan from public.workspaces where id = p_workspace;
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into used
  from storage.objects o
  where o.bucket_id in ('receipts', 'payment-proofs', 'documents') and split_part(o.name, '/', 1) = p_workspace::text;
  return jsonb_build_object(
    'plan', ws_plan,
    'storage_used', used,
    'documents_sent', (select count(*) from public.sales_documents where workspace_id = p_workspace and kind in ('invoice', 'quote') and sent_at >= month_start),
    'owned_workspaces', (select count(*) from public.workspaces w join public.memberships m on m.workspace_id = w.id and m.user_id = (select auth.uid()) and m.role = 'owner' where w.deleted_at is null));
end;
$$;
revoke all on function public.storage_room(uuid, bigint), public.workspace_usage(uuid) from public, anon;
grant execute on function public.storage_room(uuid, bigint), public.workspace_usage(uuid) to authenticated;

-- "Sent with Ledgerly" is shown on Free documents. These say only yes or no, to anyone holding the link.
create function public.show_footer_for_document(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select w.plan <> 'pro' from public.sales_documents d join public.workspaces w on w.id = d.workspace_id where d.public_token = p_token), true);
$$;
create function public.show_footer_for_portal(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select w.plan <> 'pro' from public.portal_links l join public.workspaces w on w.id = l.workspace_id where l.token = p_token and l.revoked_at is null), true);
$$;
revoke all on function public.show_footer_for_document(text), public.show_footer_for_portal(text) from public;
grant execute on function public.show_footer_for_document(text), public.show_footer_for_portal(text) to anon, authenticated;

-- A downgraded workspace's automations stop running (they are kept, and run again if it returns to Pro).
create or replace function app.evaluate_rules(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rl record;
  m record;
  today date := (p_now at time zone 'Africa/Johannesburg')::date;
  hour_now integer := extract(hour from p_now at time zone 'Africa/Johannesburg')::int;
  fired integer := 0;
  claimed uuid;
  title text;
  note text;
  reply text;
  days_word text;
begin
  for rl in
    select r.* from public.automation_rules r
    join public.workspaces w on w.id = r.workspace_id and w.deleted_at is null and w.plan = 'pro'
    where r.enabled order by r.created_at
  loop
    if rl.action = 'send_reminder' and hour_now not between 8 and 16 then
      continue;
    end if;
    for m in select * from app.rule_matches(rl.workspace_id, rl.trigger, rl.threshold, p_now, today, (rl.created_at at time zone 'Africa/Johannesburg')::date) loop
      insert into public.automation_runs (workspace_id, rule_id, ref_key, outcome)
      values (rl.workspace_id, rl.id, m.ref_key, 'done')
      on conflict (rule_id, ref_key) do nothing
      returning id into claimed;
      if claimed is null then
        continue;
      end if;
      days_word := m.late || ' day' || case when m.late = 1 then '' else 's' end;
      begin
        if rl.action = 'notify_me' then
          title := case rl.trigger
            when 'invoice_overdue' then 'Invoice ' || m.label || ' is ' || days_word || ' overdue'
            when 'quote_unaccepted' then 'Quote ' || m.label || ' has had no answer for ' || days_word
            when 'booking_soon' then 'Booking soon: ' || m.label
            when 'task_overdue' then 'Task overdue: ' || m.label
            else m.label end;
          perform app.notify_roles(rl.workspace_id, array['owner', 'admin'], 'automation', left(title, 160), m.href, 'auto:' || rl.id || ':' || m.ref_key);
          update public.automation_runs set detail = 'Owners and admins notified' where id = claimed;
        elsif rl.action = 'create_task' then
          insert into public.tasks (workspace_id, title, notes, due_date)
          values (rl.workspace_id, left(m.task_title, 200), 'Made by your automation "' || rl.name || '".', today);
          update public.automation_runs set detail = 'Task created' where id = claimed;
        else
          if m.email is null or m.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
            update public.automation_runs set outcome = 'failed', detail = 'This client has no email address' where id = claimed;
            continue;
          end if;
          select lower(u.email) into reply from public.memberships mb join auth.users u on u.id = mb.user_id
          where mb.workspace_id = rl.workspace_id and mb.role = 'owner' order by mb.created_at limit 1;
          note := case rl.trigger
            when 'invoice_overdue' then 'Invoice ' || m.label || ' is ' || days_word || ' overdue. If you have already paid, thank you, and please ignore this.'
            else 'A friendly follow-up on quote ' || m.label || ', sent ' || days_word || ' ago. Let us know if you have any questions.' end;
          insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key)
          values (rl.workspace_id, 'reminder', m.email, reply, jsonb_build_object('document_id', m.ref_key::uuid, 'message', note),
                  'automation:' || rl.id || ':' || m.ref_key)
          on conflict (idempotency_key) do nothing;
          update public.automation_runs set detail = 'Reminder emailed to the client' where id = claimed;
        end if;
        fired := fired + 1;
      exception when others then
        update public.automation_runs set outcome = 'failed', detail = 'Something went wrong with this one' where id = claimed;
      end;
    end loop;
  end loop;
  return fired;
end;
$$;
revoke all on function app.evaluate_rules(timestamptz) from public, anon, authenticated;
