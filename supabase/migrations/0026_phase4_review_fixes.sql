-- 0026_phase4_review_fixes: fixes from the Phase 4 whole-branch review.
--   3. Starting a timer caps a forgotten one at 24 hours instead of failing.
--   4. The assignee rule applies only when a task is (re)assigned; leaving a workspace unassigns.
--   5. Bank decisions can be undone once their payment or expense is gone; an unused import can be deleted.
-- Down script: supabase/migrations/down/0026_phase4_review_fixes.sql

-- 3 -------------------------------------------------------------------------
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
  -- Same cap as stop_timer: a timer left running all weekend counts as 24 hours, not as a blocker.
  update public.time_entries
  set ended_at = least(greatest(now(), started_at + interval '1 second'), started_at + interval '24 hours')
  where workspace_id = p_workspace and user_id = me and ended_at is null;
  insert into public.time_entries (workspace_id, project_id, task_id, user_id, started_at, description)
  values (p_workspace, p_project, p_task, me, now(), nullif(left(btrim(coalesce(p_description, '')), 300), ''))
  returning time_entries.id into v_id;
  return v_id;
end;
$$;

-- 4 -------------------------------------------------------------------------
create or replace function app.task_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.tasks%rowtype;
begin
  -- Checked when someone is (re)assigned, not on every edit: a task whose person has left can still be ticked off.
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) and not exists (
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

create or replace function app.unassign_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks set assignee_id = null where workspace_id = old.workspace_id and assignee_id = old.user_id;
  return old;
end;
$$;
revoke all on function app.unassign_on_leave() from public, anon, authenticated;
create trigger unassign_on_leave after delete on public.memberships
  for each row execute function app.unassign_on_leave();

-- 5 -------------------------------------------------------------------------
/** Puts a matched or logged line back on the to-do list, once its payment or expense is gone. */
create or replace function public.reset_bank_line(p_line uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.bank_lines%rowtype;
begin
  select * into l from public.bank_lines where id = p_line for update;
  if not found or not app.has_role(l.workspace_id, array['owner', 'admin']) then
    raise exception 'Bank line not found' using errcode = 'no_data_found';
  end if;
  if l.status = 'matched' then
    if exists (select 1 from public.payments where workspace_id = l.workspace_id and method = 'eft' and provider_ref = 'manual:' || l.id) then
      raise exception 'Remove the payment from the invoice first, then undo the match' using errcode = 'LDG03';
    end if;
  elsif l.status = 'expense' then
    if exists (select 1 from public.expenses where id = l.expense_id and deleted_at is null) then
      raise exception 'Archive the expense first, then undo' using errcode = 'LDG03';
    end if;
    -- Free the idempotency key so the line can be logged again.
    update public.expenses set idempotency_key = null where id = l.expense_id;
  else
    return;
  end if;
  update public.bank_lines set status = 'new', document_id = null, expense_id = null where id = l.id;
end;
$$;

/** Deletes a statement import, e.g. one imported with the wrong columns. Refused once its lines were used. */
create or replace function public.delete_bank_import(p_import uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.bank_imports where id = p_import for update;
  if ws is null or not app.has_role(ws, array['owner', 'admin']) then
    raise exception 'Import not found' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.bank_lines where import_id = p_import and status in ('matched', 'expense')) then
    raise exception 'Some lines from this statement are matched or logged. Undo those first.' using errcode = 'LDG03';
  end if;
  delete from public.bank_imports where id = p_import;
end;
$$;

revoke all on function public.reset_bank_line(uuid) from public, anon;
revoke all on function public.delete_bank_import(uuid) from public, anon;
grant execute on function public.reset_bank_line(uuid) to authenticated;
grant execute on function public.delete_bank_import(uuid) to authenticated;
-- Deleting goes through delete_bank_import, which checks the lines first.
revoke delete on public.bank_imports from authenticated;
