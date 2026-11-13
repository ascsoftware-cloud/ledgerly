-- 0034_ai: the per-workspace AI switch (off by default), usage caps, and a global daily cap.
-- Down script: supabase/migrations/down/0034_ai.sql
--
-- Rules the database enforces (not just the screen):
--  * AI is off until an owner or admin switches it on for the workspace.
--  * Each workspace has a monthly allowance (Free 20, Pro 300; SAST months) shared by its members, and the whole
--    service has a daily cap that protects the free provider quota. A request is counted when it starts and given
--    back (once, by the person who made it) if the provider fails.
--  * Usage is written only by `ai_take`.

alter table public.workspace_settings add column ai_enabled boolean not null default false;
grant update (ai_enabled) on public.workspace_settings to authenticated;

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('chat', 'receipt', 'summary')),
  created_at timestamptz not null default now()
);
create index ai_usage_ws_idx on public.ai_usage (workspace_id, created_at desc);
create index ai_usage_user_idx on public.ai_usage (user_id);

create table public.ai_global_daily (
  day date primary key,
  requests integer not null default 0
);

alter table public.ai_usage enable row level security;
alter table public.ai_global_daily enable row level security;
revoke all on public.ai_usage, public.ai_global_daily from anon, authenticated;
grant select on public.ai_usage to authenticated;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

create or replace function public.ai_take(p_workspace uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  enabled boolean;
  ws_plan text;
  lim integer;
  month_start timestamptz := date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
  used integer;
  g integer;
  new_id uuid;
begin
  if uid is null or not app.is_member(p_workspace) then
    raise exception 'Business not found' using errcode = 'no_data_found';
  end if;
  if p_kind is null or p_kind not in ('chat', 'receipt', 'summary') then
    raise exception 'Unknown request' using errcode = 'LDG03';
  end if;
  select s.ai_enabled, w.plan into enabled, ws_plan
  from public.workspace_settings s join public.workspaces w on w.id = s.workspace_id where s.workspace_id = p_workspace;
  if not coalesce(enabled, false) then
    raise exception 'The AI helper is switched off for this business. An owner can switch it on in Settings.' using errcode = 'LDG03';
  end if;
  lim := case ws_plan when 'pro' then 300 else 20 end;
  perform pg_advisory_xact_lock(hashtext('ai:' || p_workspace::text));
  select count(*) into used from public.ai_usage where workspace_id = p_workspace and created_at >= month_start;
  if used >= lim then
    raise exception 'You have used all % AI requests for this month. They reset on the 1st.', lim using errcode = 'LDG01';
  end if;
  insert into public.ai_global_daily as d (day, requests) values (app.sast_today(), 1)
  on conflict (day) do update set requests = d.requests + 1 where d.requests < 1000
  returning requests into g;
  if g is null then
    raise exception 'The AI helper is very busy today. Please try again tomorrow.' using errcode = 'LDG01';
  end if;
  insert into public.ai_usage (workspace_id, user_id, kind) values (p_workspace, uid, p_kind) returning id into new_id;
  return jsonb_build_object('used', used + 1, 'limit', lim, 'usage_id', new_id);
end;
$$;

-- Gives a request back after the provider failed: only its own maker, only soon after.
create or replace function public.ai_release(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.ai_usage where id = p_id and user_id = (select auth.uid()) and created_at > now() - interval '15 minutes';
$$;

create or replace function public.ai_status(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
  enabled boolean;
  ws_plan text;
begin
  if not app.is_member(p_workspace) then
    raise exception 'Business not found' using errcode = 'no_data_found';
  end if;
  select s.ai_enabled, w.plan into enabled, ws_plan
  from public.workspace_settings s join public.workspaces w on w.id = s.workspace_id where s.workspace_id = p_workspace;
  return jsonb_build_object(
    'enabled', coalesce(enabled, false),
    'limit', case ws_plan when 'pro' then 300 else 20 end,
    'used', (select count(*) from public.ai_usage where workspace_id = p_workspace and created_at >= month_start));
end;
$$;

revoke all on function public.ai_take(uuid, text), public.ai_release(uuid), public.ai_status(uuid) from public, anon;
grant execute on function public.ai_take(uuid, text), public.ai_release(uuid), public.ai_status(uuid) to authenticated;
