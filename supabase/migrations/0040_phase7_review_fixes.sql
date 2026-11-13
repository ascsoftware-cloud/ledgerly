-- 0040_phase7_review_fixes: fixes from the independent Phase 7 review.
-- Down script: supabase/migrations/down/0040_phase7_review_fixes.sql
--
-- 1. Billing: one open checkout per workspace and hour; a second PayFast subscription for the same business is
--    recognised (not silently swapped in), a cancelled subscription is never brought back by a late notice, no
--    upgrade while a deletion is pending, and billing records outlive a deleted business (we keep our own revenue
--    records).
-- 2. Deletion: a business is not purged while PayFast is still charging for it; account deletion can always finish
--    (a business cannot be kept on its own while its account is going, and none can be added); cancelling an account
--    deletion only restores what that request flagged.
-- 3. Consents cannot be backdated.
-- 4. The Free storage cap also holds against direct Storage API uploads.
-- 5. A private bucket for export downloads.

-- ---------------------------------------------------------------------------
-- 1. Billing
-- ---------------------------------------------------------------------------
alter table public.billing_events drop constraint billing_events_workspace_id_fkey;
alter table public.billing_events alter column workspace_id drop not null;
alter table public.billing_events add constraint billing_events_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces (id) on delete set null;

create or replace function public.billing_start_checkout(p_workspace uuid, p_user uuid, p_amount_cents integer)
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
  if exists (select 1 from public.workspaces w where w.id = p_workspace and w.deletion_requested_at is not null) then
    raise exception 'This business is waiting to be deleted. Keep it first if you want to upgrade.' using errcode = 'LDG03';
  end if;
  -- Pressing Upgrade twice in the hour reuses the same checkout rather than opening a second subscription.
  select c.id into new_id from public.billing_checkouts c
    where c.workspace_id = p_workspace and c.user_id = p_user and c.amount_cents = p_amount_cents and c.created_at > now() - interval '1 hour'
    order by c.created_at desc limit 1;
  if found then
    return new_id;
  end if;
  insert into public.billing_checkouts (workspace_id, user_id, amount_cents) values (p_workspace, p_user, p_amount_cents) returning id into new_id;
  return new_id;
end;
$$;

-- Returns 'activated', 'extended', 'extra_subscription' (a second PayFast subscription for a business that already has
-- one: the server cancels the extra one), 'duplicate' or 'unknown'.
create or replace function public.billing_apply_payment(p_checkout uuid, p_token text, p_pf_payment_id text, p_amount_cents integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  existing public.subscriptions%rowtype;
  checkout public.billing_checkouts%rowtype;
  st text;
  resub boolean;
begin
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
    -- A different token while the business is still subscribed: a second subscription. Keep the first, give
    -- the month that was paid for, and tell the server to cancel the extra one.
    if existing.status in ('active', 'cancelling') and existing.token is not null and p_token is not null and existing.token <> p_token then
      update public.subscriptions set current_period_end = greatest(now(), current_period_end) + interval '1 month', updated_at = now() where workspace_id = ws;
      update public.workspaces set plan = 'pro' where id = ws;
      return 'extra_subscription';
    end if;
    resub := existing.status = 'cancelled' and p_token is not null and existing.token is distinct from p_token;
    -- Back to active only for a late payer whose payment arrived, or a fresh subscription. A subscription the
    -- owner cancelled stays cancelling: it gets the month that was already charged, then ends.
    if resub or existing.status = 'active' or (existing.status = 'cancelled' and existing.cancelled_at is null) then
      st := 'active';
    else
      st := 'cancelling';
    end if;
    update public.subscriptions
      set status = st,
          cancelled_at = case when st = 'active' then null else cancelled_at end,
          token = case when resub then p_token else coalesce(token, p_token) end,
          price_cents = p_amount_cents,
          current_period_end = greatest(now(), current_period_end) + interval '1 month',
          updated_at = now()
      where workspace_id = ws;
  else
    insert into public.subscriptions (workspace_id, status, token, price_cents, current_period_end)
    values (ws, 'active', p_token, p_amount_cents, now() + interval '1 month');
  end if;
  update public.workspaces set plan = 'pro' where id = ws;
  return case when existing.workspace_id is null then 'activated' else 'extended' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Deletion
-- ---------------------------------------------------------------------------
alter table public.workspaces add column deletion_via_account boolean not null default false;

create or replace function public.cancel_workspace_deletion(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces%rowtype;
begin
  if (select auth.uid()) is null or not app.has_role(p_workspace, array['owner']) then
    raise exception 'Only the owner can do that' using errcode = 'LDG03';
  end if;
  select * into w from public.workspaces where id = p_workspace;
  if w.deletion_via_account and exists (select 1 from public.profiles p where p.id = w.deletion_requested_by and p.deletion_requested_at is not null) then
    raise exception 'This business is being deleted along with your account. Keep your account to keep it.' using errcode = 'LDG03';
  end if;
  update public.workspaces set deletion_requested_at = null, deletion_requested_by = null, deletion_via_account = false where id = p_workspace;
end;
$$;

create or replace function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  w record;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  for w in
    select ws.id, ws.name from public.workspaces ws join public.memberships m on m.workspace_id = ws.id and m.user_id = uid and m.role = 'owner'
    where ws.deletion_requested_at is null
  loop
    if exists (select 1 from public.memberships o where o.workspace_id = w.id and o.user_id <> uid) then
      raise exception 'Remove the other people from "%" first, or delete that business.', w.name using errcode = 'LDG03';
    end if;
    if exists (select 1 from public.subscriptions s where s.workspace_id = w.id and s.status = 'active') then
      raise exception 'Cancel Pro for "%" first, so you are not charged again.', w.name using errcode = 'LDG03';
    end if;
  end loop;
  update public.workspaces ws set deletion_requested_at = now(), deletion_requested_by = uid, deletion_via_account = true
    where ws.deletion_requested_at is null and exists (select 1 from public.memberships m where m.workspace_id = ws.id and m.user_id = uid and m.role = 'owner');
  update public.profiles set deletion_requested_at = coalesce(deletion_requested_at, now()) where id = uid;
  return (select deletion_requested_at from public.profiles where id = uid) + interval '7 days';
end;
$$;

-- Only what that request flagged: a business deletion asked for separately stays as it was.
create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  update public.workspaces set deletion_requested_at = null, deletion_requested_by = null, deletion_via_account = false
    where deletion_requested_by = uid and deletion_via_account;
  update public.profiles set deletion_requested_at = null where id = uid;
end;
$$;

-- A person whose account is going cannot start another business.
create or replace function public.create_additional_workspace(p_name text)
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
  if exists (select 1 from public.profiles p where p.id = uid and p.deletion_requested_at is not null) then
    raise exception 'Your account is waiting to be deleted. Keep it first if you want to add a business.' using errcode = 'LDG03';
  end if;
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

-- What the daily job may delete. A business PayFast is still charging for is NOT deleted (it is listed as
-- `blocked` so the server can raise an alert); an account is only due once none of its businesses is blocked.
create or replace function public.purge_due()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspaces', coalesce((select jsonb_agg(w.id) from public.workspaces w
      where w.deletion_requested_at < now() - interval '7 days'
        and not exists (select 1 from public.subscriptions s where s.workspace_id = w.id and s.status = 'active')), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(w.id) from public.workspaces w
      where w.deletion_requested_at < now() - interval '7 days'
        and exists (select 1 from public.subscriptions s where s.workspace_id = w.id and s.status = 'active')), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(p.id) from public.profiles p
      where p.deletion_requested_at < now() - interval '7 days'
        and not exists (select 1 from public.memberships m join public.subscriptions s on s.workspace_id = m.workspace_id and s.status = 'active'
                        where m.user_id = p.id and m.role = 'owner')), '[]'::jsonb));
$$;
revoke all on function public.purge_due() from public, anon, authenticated;
grant execute on function public.purge_due() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Consents cannot be backdated: only these columns can be written
-- ---------------------------------------------------------------------------
revoke insert on public.consents from authenticated;
grant insert (user_id, workspace_id, kind, granted, version) on public.consents to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The Free storage cap against direct uploads (the size of the file being added is not known to a policy, so the
--    cap holds to within one file: once a business is over it, nothing more can be added)
-- ---------------------------------------------------------------------------
drop policy documents_write on storage.objects;
create policy documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and (select app.has_role(app.folder_workspace(name), array['owner', 'admin', 'staff']))
              and (select public.storage_room(app.folder_workspace(name), 0)));
drop policy receipts_write on storage.objects;
create policy receipts_write on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
              and (select app.has_role(app.folder_workspace(name), array['owner', 'admin', 'staff']))
              and (select public.storage_room(app.folder_workspace(name), 0)));
drop policy payment_proofs_write on storage.objects;
create policy payment_proofs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs'
              and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
              and (select app.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'staff']))
              and (select public.storage_room(((storage.foldername(name))[1])::uuid, 0)));

-- ---------------------------------------------------------------------------
-- 5. Where export downloads are kept for a few minutes (private; no policies: only the server reaches it)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('exports', 'exports', false, 52428800)
on conflict (id) do nothing;
