-- 0002_provisioning: turns onboarding answers into a ready workspace, plus the
-- reward tables (quest, XP, streak, goal) the dashboard shows.
-- Down script: supabase/migrations/down/0002_provisioning.sql

-- ---------------------------------------------------------------------------
-- Let the very first membership of a brand-new workspace be its owner.
-- (Memberships can only be inserted by security-definer functions; see grants.)
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
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces w where w.id = ws) then
    return old;
  end if;

  -- Founding member of an empty workspace.
  if tg_op = 'INSERT' and not exists (select 1 from public.memberships m where m.workspace_id = ws) then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.user_id <> old.user_id) then
    raise exception 'A membership cannot be moved to another workspace or user'
      using errcode = 'check_violation';
  end if;

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

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.onboarding_answers (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  answers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index onboarding_answers_user_id_idx on public.onboarding_answers (user_id);

-- Titles and links live in the app (src/features/quest/catalogue.ts); the database keeps state.
create table public.quest_steps (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null check (key in ('business_details', 'first_client', 'first_invoice',
                                   'get_paid_setup', 'first_expense', 'first_task',
                                   'first_product', 'booking_page', 'invite_team')),
  position smallint not null check (position between 1 and 20),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('invoice_sent', 'payment_received', 'expense_logged',
                                     'task_completed', 'quest_step')),
  -- What earned the points, so the same thing never pays out twice.
  ref text not null check (char_length(ref) between 1 and 100),
  points smallint not null check (points > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, ref)
);
create index xp_events_user_id_idx on public.xp_events (user_id);

create table public.streaks (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  current_days integer not null default 0 check (current_days >= 0),
  longest_days integer not null default 0 check (longest_days >= 0),
  last_active_on date,
  -- Monday of the week in which the one weekly freeze was spent.
  freeze_week date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index streaks_user_id_idx on public.streaks (user_id);

create table public.goals (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('monthly_revenue')),
  target_cents bigint not null check (target_cents > 0 and target_cents <= 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, kind)
);

create trigger touch_onboarding_answers before update on public.onboarding_answers
  for each row execute function app.touch_updated_at();
create trigger touch_quest_steps before update on public.quest_steps
  for each row execute function app.touch_updated_at();
create trigger touch_streaks before update on public.streaks
  for each row execute function app.touch_updated_at();
create trigger touch_goals before update on public.goals
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Rewards: XP, streaks, quest completion. Internal only (not callable by users).
-- ---------------------------------------------------------------------------
create or replace function app.sast_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Africa/Johannesburg')::date;
$$;

create or replace function app.bump_streak(ws uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := app.sast_today();
  this_week date := date_trunc('week', today)::date;
  s public.streaks%rowtype;
  next_days integer;
  next_freeze date;
begin
  select * into s from public.streaks where workspace_id = ws and user_id = uid for update;
  if not found then
    insert into public.streaks (workspace_id, user_id, current_days, longest_days, last_active_on)
    values (ws, uid, 1, 1, today)
    on conflict (workspace_id, user_id) do nothing;
    return;
  end if;

  if s.last_active_on = today then
    return;
  end if;

  next_freeze := s.freeze_week;
  if s.last_active_on = today - 1 then
    next_days := s.current_days + 1;
  elsif s.last_active_on = today - 2 and s.freeze_week is distinct from this_week then
    -- One missed day a week is forgiven.
    next_days := s.current_days + 1;
    next_freeze := this_week;
  else
    next_days := 1;
  end if;

  update public.streaks
  set current_days = next_days,
      longest_days = greatest(longest_days, next_days),
      last_active_on = today,
      freeze_week = next_freeze
  where workspace_id = ws and user_id = uid;
end;
$$;

create or replace function app.award_xp(ws uuid, uid uuid, what text, ref text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  pts smallint := case what
    when 'invoice_sent' then 20
    when 'payment_received' then 50
    when 'expense_logged' then 5
    when 'task_completed' then 5
    when 'quest_step' then 30
  end;
  inserted integer;
begin
  if pts is null then
    raise exception 'Unknown XP kind %', what using errcode = 'check_violation';
  end if;
  insert into public.xp_events (workspace_id, user_id, kind, ref, points)
  values (ws, uid, what, ref, pts)
  on conflict (workspace_id, kind, ref) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 and uid is not null then
    perform app.bump_streak(ws, uid);
  end if;
  return inserted = 1;
end;
$$;

create or replace function app.complete_quest_step(ws uuid, step text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  done integer;
begin
  update public.quest_steps
  set completed_at = now()
  where workspace_id = ws and key = step and completed_at is null;
  get diagnostics done = row_count;
  if done = 1 then
    perform app.award_xp(ws, (select auth.uid()), 'quest_step', step);
  end if;
end;
$$;

-- Quest steps that complete from tables that already exist. Later migrations add
-- triggers for clients, invoices, expenses and so on.
create or replace function app.quest_on_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(new.business_name), '') <> '' then
    perform app.complete_quest_step(new.workspace_id, 'business_details');
  end if;
  if new.payment_methods && array['yoco', 'payfast'] or new.bank_details is not null then
    perform app.complete_quest_step(new.workspace_id, 'get_paid_setup');
  end if;
  return new;
end;
$$;

create trigger quest_on_settings after update on public.workspace_settings
  for each row execute function app.quest_on_settings();

create or replace function app.quest_on_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.complete_quest_step(new.workspace_id, 'invite_team');
  return new;
end;
$$;

create trigger quest_on_invite after insert on public.invites
  for each row execute function app.quest_on_invite();

-- ---------------------------------------------------------------------------
-- Provisioning
-- ---------------------------------------------------------------------------

-- True when `arr` is a non-empty JSON array of distinct strings, all from `allowed`.
create or replace function app.json_pick(arr jsonb, allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(arr) = 'array'
    and jsonb_array_length(arr) between 1 and cardinality(allowed)
    and (
      select bool_and(jsonb_typeof(e) = 'string' and (e #>> '{}') = any (allowed))
        and count(distinct e) = count(*)
      from jsonb_array_elements(arr) as e
    ),
    false
  );
$$;

-- Mirrors answersSchema in src/features/onboarding/schema.ts. Keep the two in step.
create or replace function app.valid_answers(a jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(a) = 'object'
    and a -> 'v' = '1'::jsonb
    and a ->> 'business' in ('service', 'online_store', 'freelancer', 'agency', 'food', 'trades', 'other')
    and a ->> 'team' in ('solo', '2_5', '6_20', '20_plus')
    and app.json_pick(a -> 'headaches', array['getting_paid', 'tracking_money', 'finding_clients',
                                              'managing_tasks', 'stock', 'admin'])
    and app.json_pick(a -> 'manage', array['invoices', 'clients', 'projects', 'expenses',
                                           'inventory', 'team', 'bookings'])
    and app.json_pick(a -> 'paid', array['cash', 'eft', 'card', 'yoco', 'payfast', 'none'])
    and (not (a -> 'paid') ? 'none' or jsonb_array_length(a -> 'paid') = 1)
    and a ->> 'revenue' in ('none', 'under_20k', '20k_100k', '100k_500k', '500k_plus')
    and a ->> 'accent' in ('emerald', 'indigo', 'coral', 'amber', 'violet', 'sky')
    and a ->> 'mode' in ('light', 'dark')
    and a -> 'dailyMinutes' in ('5'::jsonb, '10'::jsonb, '15'::jsonb),
    false
  );
$$;

create or replace function app.default_quest(ws uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.quest_steps (workspace_id, key, position)
  values (ws, 'business_details', 1), (ws, 'first_client', 2),
         (ws, 'first_invoice', 3), (ws, 'get_paid_setup', 4)
  on conflict (workspace_id, key) do nothing;
$$;

create or replace function app.apply_answers(ws uuid, uid uuid, a jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  manage text[] := array(select jsonb_array_elements_text(a -> 'manage'));
  headaches text[] := array(select jsonb_array_elements_text(a -> 'headaches'));
  paid text[] := array(select jsonb_array_elements_text(a -> 'paid'));
  business text := a ->> 'business';
  modules text[];
  steps text[] := array['business_details', 'first_client', 'first_invoice'];
  candidate text;
begin
  -- Modules: the two essentials, what they asked for, and what their kind of business needs.
  modules := array['invoices', 'clients'] || manage
    || case
         when business in ('online_store', 'food') then array['inventory']
         when business in ('service', 'trades') then array['bookings']
         when business in ('agency', 'freelancer') then array['projects']
         else array[]::text[]
       end;
  insert into public.workspace_modules (workspace_id, module, enabled)
  select distinct ws, m, true from unnest(modules) as m
  on conflict (workspace_id, module) do update set enabled = true;

  update public.workspaces
  set accent = a ->> 'accent', mode = a ->> 'mode', needs_setup = false
  where id = ws;

  update public.workspace_settings
  set payment_methods = array(select p from unnest(paid) as p where p <> 'none'),
      daily_minutes = (a ->> 'dailyMinutes')::smallint
  where workspace_id = ws;

  -- First monthly goal: the middle of the range they picked.
  insert into public.goals (workspace_id, kind, target_cents)
  values (ws, 'monthly_revenue', case a ->> 'revenue'
            when 'none' then 500000
            when 'under_20k' then 1000000
            when '20k_100k' then 6000000
            when '100k_500k' then 30000000
            else 75000000
          end)
  on conflict (workspace_id, kind) do update set target_cents = excluded.target_cents;

  -- Setup quest: three essentials, then steps for their headaches and modules (max 6).
  foreach candidate in array array['get_paid_setup', 'first_expense', 'first_task',
                                   'first_product', 'booking_page', 'invite_team'] loop
    exit when cardinality(steps) >= 6;
    if (candidate = 'get_paid_setup' and ('getting_paid' = any (headaches) or paid && array['yoco', 'payfast']))
      or (candidate = 'first_expense' and ('tracking_money' = any (headaches) or 'expenses' = any (modules)))
      or (candidate = 'first_task' and ('managing_tasks' = any (headaches) or 'projects' = any (modules)))
      or (candidate = 'first_product' and ('stock' = any (headaches) or 'inventory' = any (modules)))
      or (candidate = 'booking_page' and 'bookings' = any (modules))
      or (candidate = 'invite_team' and (a ->> 'team' <> 'solo' or 'team' = any (modules))) then
      steps := steps || candidate;
    end if;
  end loop;
  foreach candidate in array array['get_paid_setup', 'first_expense'] loop
    exit when cardinality(steps) >= 4;
    if not candidate = any (steps) then
      steps := steps || candidate;
    end if;
  end loop;

  delete from public.quest_steps where workspace_id = ws and completed_at is null;
  insert into public.quest_steps (workspace_id, key, position)
  select ws, s.key, s.n from unnest(steps) with ordinality as s (key, n)
  on conflict (workspace_id, key) do update set position = excluded.position;

  insert into public.onboarding_answers (workspace_id, user_id, answers)
  values (ws, uid, a)
  on conflict (workspace_id) do update set answers = excluded.answers, user_id = excluded.user_id;
end;
$$;

/**
 * Creates the signed-in user's first workspace from their onboarding answers
 * (or sensible defaults when the answers are null, e.g. they signed in on another
 * device). Safe to call repeatedly: it returns the existing workspace, and only
 * applies answers to it if it was created without them.
 * Returns {"id": uuid, "slug": text, "created": boolean}.
 */
create or replace function public.provision_workspace(answers jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  a jsonb := answers;
  ws_id uuid;
  ws_slug text;
  ws_needs boolean;
  display_name text;
  first_name text;
  base text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if a is not null and jsonb_typeof(a) = 'null' then
    a := null;
  end if;
  if a is not null and not app.valid_answers(a) then
    raise exception 'Onboarding answers are not valid' using errcode = 'check_violation';
  end if;

  -- One provisioning at a time per user, so a double tap cannot create two workspaces.
  perform pg_advisory_xact_lock(hashtextextended('provision:' || uid::text, 0));

  select w.id, w.slug, w.needs_setup into ws_id, ws_slug, ws_needs
  from public.workspaces w
  join public.memberships m on m.workspace_id = w.id and m.user_id = uid and m.role = 'owner'
  where w.created_by = uid and w.deleted_at is null
  order by w.created_at
  limit 1;

  if found then
    if ws_needs and a is not null then
      perform app.apply_answers(ws_id, uid, a);
    end if;
    return jsonb_build_object('id', ws_id, 'slug', ws_slug, 'created', false);
  end if;

  -- Name it after the person: "Thandi's business".
  select coalesce(nullif(btrim(p.full_name), ''), split_part(u.email, '@', 1))
  into display_name
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = uid;
  first_name := initcap(lower(substring(coalesce(display_name, '') from '[A-Za-z]+')));
  base := lower(coalesce(first_name, ''));
  if char_length(base) < 2 then
    base := 'biz';
  end if;
  base := left(base, 24);

  loop
    ws_slug := base || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
    exit when not exists (select 1 from public.workspaces w where w.slug = ws_slug);
  end loop;

  insert into public.workspaces (slug, name, created_by, needs_setup)
  values (
    ws_slug,
    case when coalesce(first_name, '') = '' then 'My business' else left(first_name, 60) || '''s business' end,
    uid,
    a is null
  )
  returning id into ws_id;

  insert into public.memberships (workspace_id, user_id, role) values (ws_id, uid, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws_id);
  insert into public.workspace_modules (workspace_id, module)
  values (ws_id, 'invoices'), (ws_id, 'clients');
  insert into public.goals (workspace_id, kind, target_cents) values (ws_id, 'monthly_revenue', 1000000);
  insert into public.streaks (workspace_id, user_id) values (ws_id, uid);

  if a is null then
    perform app.default_quest(ws_id);
  else
    perform app.apply_answers(ws_id, uid, a);
  end if;

  return jsonb_build_object('id', ws_id, 'slug', ws_slug, 'created', true);
end;
$$;

-- Deliberately callable by signed-in users, which the Supabase advisor reports as lint 0029.
-- It is the only way to create a workspace; identity comes from auth.uid() (the JWT), never
-- from arguments; input is validated; repeated calls are no-ops. The alternative (service-role
-- call from app code passing a user id) would widen service-role use and trust app code instead.
revoke all on function public.provision_workspace(jsonb) from public, anon;
grant execute on function public.provision_workspace(jsonb) to authenticated;

revoke all on function app.sast_today() from public, anon, authenticated;
revoke all on function app.bump_streak(uuid, uuid) from public, anon, authenticated;
revoke all on function app.award_xp(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function app.complete_quest_step(uuid, text) from public, anon, authenticated;
revoke all on function app.quest_on_settings() from public, anon, authenticated;
revoke all on function app.quest_on_invite() from public, anon, authenticated;
revoke all on function app.json_pick(jsonb, text[]) from public, anon, authenticated;
revoke all on function app.valid_answers(jsonb) from public, anon, authenticated;
revoke all on function app.default_quest(uuid) from public, anon, authenticated;
revoke all on function app.apply_answers(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security. All writes go through the functions above, except goal targets.
-- ---------------------------------------------------------------------------
alter table public.onboarding_answers enable row level security;
alter table public.quest_steps enable row level security;
alter table public.xp_events enable row level security;
alter table public.streaks enable row level security;
alter table public.goals enable row level security;

revoke all on public.onboarding_answers, public.quest_steps, public.xp_events,
  public.streaks, public.goals from anon, authenticated;
grant select on public.onboarding_answers, public.quest_steps, public.xp_events,
  public.streaks, public.goals to authenticated;
grant update (target_cents) on public.goals to authenticated;

create policy onboarding_answers_select on public.onboarding_answers for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy quest_steps_select on public.quest_steps for select to authenticated
  using ((select app.is_member(workspace_id)));

create policy xp_events_select on public.xp_events for select to authenticated
  using ((select app.is_member(workspace_id)));

create policy streaks_select on public.streaks for select to authenticated
  using (user_id = (select auth.uid()) and (select app.is_member(workspace_id)));

create policy goals_select on public.goals for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy goals_update on public.goals for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
