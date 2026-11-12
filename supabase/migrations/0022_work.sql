-- 0022_work: projects (optionally for a client) and tasks with one level of subtasks.
-- List, board and calendar are views over the same tasks query.
-- Down script: supabase/migrations/down/0022_work.sql

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  contact_id uuid,
  -- For billable hours (Task 4.4). 0 = not billed.
  hourly_rate_cents bigint not null default 0 check (hourly_rate_cents >= 0 and hourly_rate_cents <= 10000000),
  status text not null default 'active' check (status in ('active', 'done')),
  notes text check (char_length(notes) <= 2000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete set null (contact_id)
);
create index projects_ws_idx on public.projects (workspace_id, created_at desc) where deleted_at is null;
create index projects_contact_idx on public.projects (workspace_id, contact_id);
create index projects_created_by_idx on public.projects (created_by);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid,
  parent_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text check (char_length(notes) <= 2000),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date date,
  assignee_id uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (parent_id is null or parent_id <> id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (workspace_id, parent_id) references public.tasks (workspace_id, id) on delete cascade
);
create index tasks_ws_status_idx on public.tasks (workspace_id, status, due_date);
create index tasks_ws_due_idx on public.tasks (workspace_id, due_date) where due_date is not null;
create index tasks_project_idx on public.tasks (workspace_id, project_id);
create index tasks_parent_idx on public.tasks (workspace_id, parent_id);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_created_by_idx on public.tasks (created_by);

create trigger touch_projects before update on public.projects for each row execute function app.touch_updated_at();
create trigger touch_tasks before update on public.tasks for each row execute function app.touch_updated_at();
create trigger fixed_ws_projects before update on public.projects for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_tasks before update on public.tasks for each row execute function app.forbid_workspace_change();

-- Archiving or restoring a project is for owners and admins; staff can still edit it.
create or replace function app.guard_project_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and current_user = 'authenticated'
     and not app.has_role(new.workspace_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can archive projects' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger guard_project_archive before update on public.projects
  for each row execute function app.guard_project_archive();

/**
 * Task rules: the assignee must be a member; a subtask sits one level under a top-level task
 * and always belongs to its parent's project; finishing a task stamps it and earns XP once.
 */
create or replace function app.task_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.tasks%rowtype;
begin
  if new.assignee_id is not null and not exists (
    select 1 from public.memberships m where m.workspace_id = new.workspace_id and m.user_id = new.assignee_id
  ) then
    raise exception 'Tasks can only be assigned to people in this workspace' using errcode = 'check_violation';
  end if;
  if new.parent_id is not null then
    select * into parent from public.tasks where id = new.parent_id and workspace_id = new.workspace_id;
    if found then
      if parent.parent_id is not null then
        raise exception 'Subtasks go one level deep' using errcode = 'check_violation';
      end if;
      new.project_id := parent.project_id;
    end if;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger task_rules before insert or update on public.tasks
  for each row execute function app.task_rules();

create or replace function app.task_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.complete_quest_step(new.workspace_id, 'first_task');
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    perform app.award_xp(new.workspace_id, (select auth.uid()), 'task_completed', new.id::text);
  end if;
  return new;
end;
$$;
create trigger task_events after insert or update on public.tasks
  for each row execute function app.task_events();

revoke all on function app.guard_project_archive() from public, anon, authenticated;
revoke all on function app.task_rules() from public, anon, authenticated;
revoke all on function app.task_events() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
revoke all on public.projects, public.tasks from anon, authenticated;

grant select on public.projects, public.tasks to authenticated;
grant insert (workspace_id, name, contact_id, hourly_rate_cents, status, notes) on public.projects to authenticated;
grant update (name, contact_id, hourly_rate_cents, status, notes, deleted_at) on public.projects to authenticated;
grant delete on public.projects to authenticated;
grant insert (workspace_id, project_id, parent_id, title, notes, status, priority, due_date, assignee_id) on public.tasks to authenticated;
grant update (project_id, title, notes, status, priority, due_date, assignee_id) on public.tasks to authenticated;
grant delete on public.tasks to authenticated;

create policy projects_select on public.projects for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy projects_insert on public.projects for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy projects_update on public.projects for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy projects_delete on public.projects for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy tasks_select on public.tasks for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy tasks_update on public.tasks for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy tasks_delete on public.tasks for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
