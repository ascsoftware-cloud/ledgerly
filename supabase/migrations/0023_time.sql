-- 0023_time: time tracking (timer and manual), and billable hours → a draft invoice.
-- Down script: supabase/migrations/down/0023_time.sql

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid,
  task_id uuid,
  -- Always the person who logged it; nobody logs time as someone else.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  description text check (char_length(description) <= 300),
  billable boolean not null default true,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (ended_at is null or (ended_at > started_at and ended_at - started_at <= interval '24 hours')),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id) on delete set null (task_id),
  -- Deleting the draft invoice frees the hours to be billed again.
  foreign key (workspace_id, invoice_id) references public.sales_documents (workspace_id, id) on delete set null (invoice_id)
);
create unique index time_entries_one_running on public.time_entries (workspace_id, user_id) where ended_at is null;
create index time_entries_ws_started_idx on public.time_entries (workspace_id, started_at desc);
create index time_entries_project_idx on public.time_entries (workspace_id, project_id);
create index time_entries_task_idx on public.time_entries (workspace_id, task_id);
create index time_entries_invoice_idx on public.time_entries (workspace_id, invoice_id);
create index time_entries_user_idx on public.time_entries (user_id);

create trigger touch_time_entries before update on public.time_entries for each row execute function app.touch_updated_at();
create trigger fixed_ws_time_entries before update on public.time_entries for each row execute function app.forbid_workspace_change();

/** Starts a timer for the signed-in person, stopping any timer they already have running. */
create or replace function public.start_timer(p_workspace uuid, p_project uuid, p_task uuid, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_id uuid;
begin
  if not app.has_role(p_workspace, array['owner', 'admin', 'staff']) then
    raise exception 'Your role cannot track time' using errcode = 'insufficient_privilege';
  end if;
  update public.time_entries
  set ended_at = greatest(now(), started_at + interval '1 second')
  where workspace_id = p_workspace and user_id = me and ended_at is null;
  insert into public.time_entries (workspace_id, project_id, task_id, user_id, started_at, description)
  values (p_workspace, p_project, p_task, me, now(), nullif(left(btrim(coalesce(p_description, '')), 300), ''))
  returning time_entries.id into v_id;
  return v_id;
end;
$$;

/** Stops the signed-in person's running timer, if any. Timers over 24 hours are capped. */
create or replace function public.stop_timer(p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_role(p_workspace, array['owner', 'admin', 'staff']) then
    raise exception 'Your role cannot track time' using errcode = 'insufficient_privilege';
  end if;
  update public.time_entries
  set ended_at = least(greatest(now(), started_at + interval '1 second'), started_at + interval '24 hours')
  where workspace_id = p_workspace and user_id = (select auth.uid()) and ended_at is null
  returning time_entries.id into v_id;
  return v_id;
end;
$$;

/**
 * Billable, finished, not-yet-invoiced entries of one project → one draft invoice for the
 * project's client: a line per entry, hours (2 dp) × the project's rate, VAT if registered.
 */
create or replace function public.invoice_time_entries(p_project uuid, p_entries uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.projects%rowtype;
  inv uuid;
  wanted integer := coalesce(array_length(p_entries, 1), 0);
  usable integer;
  vat smallint;
begin
  select * into p from public.projects where id = p_project and deleted_at is null;
  if not found or not app.has_role(p.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;
  if wanted = 0 then
    raise exception 'Choose the hours to bill' using errcode = 'LDG03';
  end if;
  if p.contact_id is null then
    raise exception 'Add a client to the project first, so the invoice knows who to bill' using errcode = 'LDG03';
  end if;
  if p.hourly_rate_cents <= 0 then
    raise exception 'Set an hourly rate on the project first' using errcode = 'LDG03';
  end if;

  perform 1 from public.time_entries where id = any (p_entries) for update;
  select count(*) into usable from public.time_entries
  where id = any (p_entries) and workspace_id = p.workspace_id and project_id = p.id
    and billable and ended_at is not null and invoice_id is null;
  if usable <> wanted then
    raise exception 'Some of these hours are already on an invoice, not billable, or still running' using errcode = 'LDG03';
  end if;

  select case when s.vat_registered then 15 else 0 end into vat from public.workspace_settings s where s.workspace_id = p.workspace_id;
  insert into public.sales_documents (workspace_id, kind, contact_id, notes)
  values (p.workspace_id, 'invoice', p.contact_id, left('Time for ' || p.name, 2000))
  returning id into inv;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate)
  select p.workspace_id, inv, row_number() over (order by e.started_at),
         left(coalesce(e.description, t.title, 'Work') || ' (' || to_char(e.started_at at time zone 'Africa/Johannesburg', 'FMDD Mon YYYY') || ')', 300),
         round(extract(epoch from (e.ended_at - e.started_at)) / 3600.0, 2),
         p.hourly_rate_cents, coalesce(vat, 0)
  from public.time_entries e left join public.tasks t on t.id = e.task_id
  where e.id = any (p_entries);
  perform app.recalc_document(inv);
  update public.time_entries set invoice_id = inv where id = any (p_entries);
  return inv;
end;
$$;

revoke all on function public.start_timer(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.stop_timer(uuid) from public, anon;
revoke all on function public.invoice_time_entries(uuid, uuid[]) from public, anon;
grant execute on function public.start_timer(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stop_timer(uuid) to authenticated;
grant execute on function public.invoice_time_entries(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: everyone reads; people log and edit their own, un-invoiced time;
-- owners and admins can fix anyone's un-invoiced time.
-- ---------------------------------------------------------------------------
alter table public.time_entries enable row level security;
revoke all on public.time_entries from anon, authenticated;
grant select, delete on public.time_entries to authenticated;
grant insert (workspace_id, project_id, task_id, started_at, ended_at, description, billable) on public.time_entries to authenticated;
grant update (project_id, task_id, started_at, ended_at, description, billable) on public.time_entries to authenticated;

create policy time_entries_select on public.time_entries for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy time_entries_update on public.time_entries for update to authenticated
  using (invoice_id is null and (user_id = (select auth.uid()) or (select app.has_role(workspace_id, array['owner', 'admin']))))
  with check (invoice_id is null and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (invoice_id is null and (user_id = (select auth.uid()) or (select app.has_role(workspace_id, array['owner', 'admin']))));
