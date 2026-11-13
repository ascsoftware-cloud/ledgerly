-- 0039_popia: consent records, data export, and deletion of a business or an account with a 7-day grace.
-- Down script: supabase/migrations/down/0039_popia.sql
--
-- Rules the database enforces:
--  * Consent to a specific processing (AI provider, web push, terms) is recorded when given and when withdrawn,
--    by the person themselves, for businesses they belong to.
--  * Only an owner can export a business's data. The export runs AS THE PERSON (security invoker), so row-level
--    security and column privileges decide what is in it: every table that has a workspace_id, this business's rows
--    only, and nothing a signed-in person may not read (for example a PayFast token).
--  * Deleting a business is requested by its owner and happens 7 days later, in a daily server job; the owner can
--    cancel until then. A business with an active Pro subscription must be cancelled at PayFast first.
--  * Deleting an account removes the businesses the person owns alone, and leaves businesses with other people in
--    them alone: the person must remove those people (or be removed) first. Cancelling restores everything that
--    request flagged.

-- ---------------------------------------------------------------------------
-- Consents
-- ---------------------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('ai_provider', 'push', 'terms')),
  granted boolean not null,
  version text not null check (char_length(version) between 1 and 20),
  created_at timestamptz not null default now()
);
create index consents_user_idx on public.consents (user_id, created_at desc);
create index consents_ws_idx on public.consents (workspace_id);

alter table public.consents enable row level security;
revoke all on public.consents from anon, authenticated;
grant select, insert on public.consents to authenticated;
create policy consents_select on public.consents for select to authenticated using (user_id = (select auth.uid()));
create policy consents_insert on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()) and (workspace_id is null or (select app.is_member(workspace_id))));

-- ---------------------------------------------------------------------------
-- Deletion flags (not writable by people: only the functions below)
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references auth.users (id) on delete set null;
create index workspaces_deletion_idx on public.workspaces (deletion_requested_at) where deletion_requested_at is not null;
create index workspaces_deletion_by_idx on public.workspaces (deletion_requested_by);
alter table public.profiles add column deletion_requested_at timestamptz;

create function public.request_workspace_deletion(p_workspace uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  at timestamptz;
begin
  if uid is null or not app.has_role(p_workspace, array['owner']) then
    raise exception 'Only the owner can delete a business' using errcode = 'LDG03';
  end if;
  if exists (select 1 from public.subscriptions s where s.workspace_id = p_workspace and s.status = 'active') then
    raise exception 'Cancel Pro first, so you are not charged again.' using errcode = 'LDG03';
  end if;
  update public.workspaces set deletion_requested_at = coalesce(deletion_requested_at, now()), deletion_requested_by = coalesce(deletion_requested_by, uid)
    where id = p_workspace returning deletion_requested_at into at;
  return at + interval '7 days';
end;
$$;

create function public.cancel_workspace_deletion(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not app.has_role(p_workspace, array['owner']) then
    raise exception 'Only the owner can do that' using errcode = 'LDG03';
  end if;
  update public.workspaces set deletion_requested_at = null, deletion_requested_by = null where id = p_workspace;
end;
$$;

-- Returns the day everything is deleted. Refuses (naming the business) if someone else is still in a business
-- the person owns, or one of them is on an active Pro subscription.
create function public.request_account_deletion()
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
  update public.workspaces ws set deletion_requested_at = now(), deletion_requested_by = uid
    where ws.deletion_requested_at is null and exists (select 1 from public.memberships m where m.workspace_id = ws.id and m.user_id = uid and m.role = 'owner');
  update public.profiles set deletion_requested_at = coalesce(deletion_requested_at, now()) where id = uid;
  return (select deletion_requested_at from public.profiles where id = uid) + interval '7 days';
end;
$$;

create function public.cancel_account_deletion()
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
  update public.workspaces set deletion_requested_at = null, deletion_requested_by = null where deletion_requested_by = uid;
  update public.profiles set deletion_requested_at = null where id = uid;
end;
$$;

revoke all on function public.request_workspace_deletion(uuid), public.cancel_workspace_deletion(uuid),
  public.request_account_deletion(), public.cancel_account_deletion() from public, anon;
grant execute on function public.request_workspace_deletion(uuid), public.cancel_workspace_deletion(uuid),
  public.request_account_deletion(), public.cancel_account_deletion() to authenticated;

-- What the daily job should delete now (server only).
create function public.purge_due()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspaces', coalesce((select jsonb_agg(id) from public.workspaces where deletion_requested_at < now() - interval '7 days'), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(id) from public.profiles where deletion_requested_at < now() - interval '7 days'), '[]'::jsonb));
$$;
revoke all on function public.purge_due() from public, anon, authenticated;
grant execute on function public.purge_due() to service_role;

select cron.schedule('purge-daily', '0 3 * * *', $cron$select app.call_job('purge')$cron$);

-- ---------------------------------------------------------------------------
-- Export: every table with a workspace_id, this business's rows only, as the signed-in owner
-- ---------------------------------------------------------------------------
create function public.export_workspace(p_workspace uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  t record;
  cols text;
  found_rows jsonb;
  result jsonb;
begin
  if not app.has_role(p_workspace, array['owner']) then
    raise exception 'Only the owner can export a business' using errcode = 'LDG03';
  end if;
  select jsonb_build_object('workspaces', coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)) into result from public.workspaces w where w.id = p_workspace;
  for t in
    select tb.table_name from information_schema.tables tb
    where tb.table_schema = 'public' and tb.table_type = 'BASE TABLE'
      and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = tb.table_name and c.column_name = 'workspace_id')
    order by tb.table_name
  loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.table_name
      and has_column_privilege(format('public.%I', t.table_name), c.column_name, 'SELECT');
    continue when cols is null;
    execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from (select %s from public.%I where workspace_id = $1) r', cols, t.table_name)
      into found_rows using p_workspace;
    result := result || jsonb_build_object(t.table_name, found_rows);
  end loop;
  return result;
end;
$$;
revoke all on function public.export_workspace(uuid) from public, anon;
grant execute on function public.export_workspace(uuid) to authenticated;
