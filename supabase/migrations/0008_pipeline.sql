-- 0008_pipeline: sales pipeline stages and deals.
-- Down: drop trigger seed_pipeline on public.workspaces; drop table public.deals, public.pipeline_stages;
--       drop function app.seed_pipeline(uuid), app.on_workspace_created(), app.deal_activity();

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  position smallint not null check (position between 1 and 20),
  outcome text not null default 'open' check (outcome in ('open', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, position)
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  stage_id uuid not null,
  contact_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  value_cents bigint not null default 0 check (value_cents between 0 and 100000000000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (workspace_id, stage_id) references public.pipeline_stages (workspace_id, id) on delete restrict,
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete set null (contact_id)
);
create index deals_stage_idx on public.deals (workspace_id, stage_id, created_at desc);
create index deals_contact_idx on public.deals (workspace_id, contact_id);
create index deals_created_by_idx on public.deals (created_by);

create trigger touch_pipeline_stages before update on public.pipeline_stages for each row execute function app.touch_updated_at();
create trigger touch_deals before update on public.deals for each row execute function app.touch_updated_at();
create trigger fixed_ws_stages before update on public.pipeline_stages for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_deals before update on public.deals for each row execute function app.forbid_workspace_change();

create or replace function app.stamp_deal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := coalesce((select auth.uid()), new.created_by);
  return new;
end;
$$;
revoke all on function app.stamp_deal() from public, anon, authenticated;
create trigger stamp_deals before insert on public.deals for each row execute function app.stamp_deal();

-- Every workspace starts with a sensible pipeline.
create or replace function app.seed_pipeline(ws uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pipeline_stages (workspace_id, name, position, outcome)
  values (ws, 'New lead', 1, 'open'), (ws, 'In talks', 2, 'open'), (ws, 'Quote sent', 3, 'open'),
         (ws, 'Won', 4, 'won'), (ws, 'Lost', 5, 'lost')
  on conflict (workspace_id, position) do nothing;
$$;

create or replace function app.on_workspace_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_pipeline(new.id);
  return new;
end;
$$;
create trigger seed_pipeline after insert on public.workspaces for each row execute function app.on_workspace_created();

select app.seed_pipeline(id) from public.workspaces;

-- Moving a deal: stamp when it closes and note it on the client's timeline.
create or replace function app.deal_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage record;
begin
  if new.stage_id is distinct from old.stage_id then
    select name, outcome into stage from public.pipeline_stages where id = new.stage_id;
    new.closed_at := case when stage.outcome = 'open' then null else coalesce(old.closed_at, now()) end;
    if new.contact_id is not null then
      insert into public.activities (workspace_id, contact_id, kind, ref_id, summary, actor_id)
      values (new.workspace_id, new.contact_id, 'deal_moved', new.id,
              left(new.title || ' moved to ' || stage.name, 300), (select auth.uid()));
    end if;
  end if;
  return new;
end;
$$;
create trigger deal_activity before update on public.deals for each row execute function app.deal_activity();

revoke all on function app.seed_pipeline(uuid) from public, anon, authenticated;
revoke all on function app.on_workspace_created() from public, anon, authenticated;
revoke all on function app.deal_activity() from public, anon, authenticated;

alter table public.pipeline_stages enable row level security;
alter table public.deals enable row level security;
revoke all on public.pipeline_stages, public.deals from anon, authenticated;

grant select on public.pipeline_stages to authenticated;
grant update (name) on public.pipeline_stages to authenticated;
grant select, delete on public.deals to authenticated;
grant insert (workspace_id, stage_id, contact_id, title, value_cents) on public.deals to authenticated;
grant update (stage_id, contact_id, title, value_cents) on public.deals to authenticated;

create policy pipeline_stages_select on public.pipeline_stages for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy deals_select on public.deals for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy deals_insert on public.deals for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy deals_update on public.deals for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy deals_delete on public.deals for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));
