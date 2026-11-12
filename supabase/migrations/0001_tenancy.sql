-- 0001_tenancy: workspaces, memberships and the helpers every later policy uses.
-- Down script: supabase/migrations/down/0001_tenancy.sql

-- ---------------------------------------------------------------------------
-- Private schema for helpers. Not exposed through the API.
-- ---------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated, service_role;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  avatar_url text check (char_length(avatar_url) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40)
    -- The workspace slug is the first URL segment, so it must never shadow a real route.
    check (slug not in ('start', 'login', 'auth', 'api', 'book', 'portal', 'demo', 'styleguide',
                        'privacy', 'terms', 'popia', 'pricing', 'welcome', 'settings', 'admin')),
  name text not null check (char_length(name) between 1 and 80),
  plan text not null default 'free' check (plan in ('free', 'pro')),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  accent text not null default 'emerald'
    check (accent in ('emerald', 'indigo', 'coral', 'amber', 'violet', 'sky')),
  mode text not null default 'light' check (mode in ('light', 'dark')),
  needs_setup boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index workspaces_created_by_idx on public.workspaces (created_by);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff', 'accountant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Ownership is never handed out by invitation.
  role text not null check (role in ('admin', 'staff', 'accountant')),
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index invites_invited_by_idx on public.invites (invited_by);

create table public.workspace_modules (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  module text not null check (module in ('invoices', 'clients', 'projects', 'expenses',
                                         'inventory', 'team', 'bookings', 'documents', 'reports')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, module)
);

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  business_name text check (char_length(business_name) <= 120),
  registration_number text check (char_length(registration_number) <= 40),
  vat_registered boolean not null default false,
  vat_number text check (char_length(vat_number) <= 20),
  invoice_prefix text not null default 'INV-' check (invoice_prefix ~ '^[A-Z0-9-]{0,8}$'),
  payment_methods text[] not null default '{}'
    check (payment_methods <@ array['cash', 'eft', 'card', 'yoco', 'payfast']),
  bank_details jsonb,
  daily_minutes smallint not null default 10 check (daily_minutes in (5, 10, 15)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger touch_profiles before update on public.profiles
  for each row execute function app.touch_updated_at();
create trigger touch_workspaces before update on public.workspaces
  for each row execute function app.touch_updated_at();
create trigger touch_memberships before update on public.memberships
  for each row execute function app.touch_updated_at();
create trigger touch_invites before update on public.invites
  for each row execute function app.touch_updated_at();
create trigger touch_workspace_modules before update on public.workspace_modules
  for each row execute function app.touch_updated_at();
create trigger touch_workspace_settings before update on public.workspace_settings
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so policies on `memberships` can call them
-- without recursing into their own RLS. search_path is pinned.
-- ---------------------------------------------------------------------------
create or replace function app.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and w.deleted_at is null
  );
$$;

create or replace function app.has_role(ws uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
      and w.deleted_at is null
  );
$$;

-- True when the two users share at least one workspace (for showing teammates' names).
create or replace function app.shares_workspace(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

revoke all on function app.is_member(uuid) from public, anon;
revoke all on function app.has_role(uuid, text[]) from public, anon;
revoke all on function app.shares_workspace(uuid) from public, anon;
grant execute on function app.is_member(uuid) to authenticated, service_role;
grant execute on function app.has_role(uuid, text[]) to authenticated, service_role;
grant execute on function app.shares_workspace(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Membership rules that RLS alone cannot express.
-- ---------------------------------------------------------------------------
create or replace function app.guard_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_is_owner boolean;
  ws uuid := coalesce(old.workspace_id, new.workspace_id);
begin
  -- A workspace being deleted takes its memberships with it.
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces w where w.id = ws) then
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.user_id <> old.user_id) then
    raise exception 'A membership cannot be moved to another workspace or user'
      using errcode = 'check_violation';
  end if;

  -- Rules for signed-in people (server-side jobs have no auth.uid()).
  if actor is not null then
    select exists (
      select 1 from public.memberships m
      where m.workspace_id = ws and m.user_id = actor and m.role = 'owner'
    ) into actor_is_owner;

    if not actor_is_owner then
      if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' then
        raise exception 'Only an owner can change or remove an owner'
          using errcode = 'insufficient_privilege';
      end if;
      if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' then
        raise exception 'Only an owner can make someone an owner'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  -- A workspace must always keep at least one owner.
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from public.memberships m
       where m.workspace_id = ws and m.role = 'owner' and m.id <> old.id
     ) then
    raise exception 'A workspace must keep at least one owner'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_membership() from public, anon, authenticated;

create trigger guard_membership
  before insert or update or delete on public.memberships
  for each row execute function app.guard_membership();

-- A profile row for every new account.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120),
    left(new.raw_user_meta_data ->> 'avatar_url', 500)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function app.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security. Default deny: no policy means no access.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.workspace_modules enable row level security;
alter table public.workspace_settings enable row level security;

-- Privileges: nothing for anonymous visitors; signed-in users get only the
-- operations (and, where it matters, only the columns) listed here.
revoke all on public.profiles, public.workspaces, public.memberships, public.invites,
  public.workspace_modules, public.workspace_settings from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

grant select on public.workspaces to authenticated;
-- `plan` is deliberately absent: only billing (server-side) may change it.
grant update (name, accent, mode) on public.workspaces to authenticated;

grant select, delete on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;

grant select, insert, delete on public.invites to authenticated;

grant select, insert on public.workspace_modules to authenticated;
grant update (enabled) on public.workspace_modules to authenticated;

grant select on public.workspace_settings to authenticated;
grant update (business_name, registration_number, vat_registered, vat_number, invoice_prefix,
              payment_methods, bank_details, daily_minutes)
  on public.workspace_settings to authenticated;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.shares_workspace(id)));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces (created only by provision_workspace; deleted only by the account flow)
create policy workspaces_select on public.workspaces for select to authenticated
  using ((select app.is_member(id)));
create policy workspaces_update on public.workspaces for update to authenticated
  using ((select app.has_role(id, array['owner', 'admin'])))
  with check ((select app.has_role(id, array['owner', 'admin'])));

-- memberships (created only by provisioning and invite acceptance)
create policy memberships_select on public.memberships for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy memberships_update on public.memberships for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy memberships_delete on public.memberships for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select app.has_role(workspace_id, array['owner', 'admin']))
  );

-- invites
create policy invites_select on public.invites for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy invites_insert on public.invites for insert to authenticated
  with check (
    (select app.has_role(workspace_id, array['owner', 'admin']))
    and invited_by = (select auth.uid())
  );
create policy invites_delete on public.invites for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

-- workspace_modules
create policy workspace_modules_select on public.workspace_modules for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy workspace_modules_insert on public.workspace_modules for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy workspace_modules_update on public.workspace_modules for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));

-- workspace_settings
create policy workspace_settings_select on public.workspace_settings for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy workspace_settings_update on public.workspace_settings for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
