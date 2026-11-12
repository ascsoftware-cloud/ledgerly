-- 0003_fix_award_xp: the `ref` parameter of app.award_xp clashed with the
-- xp_events.ref column ("column reference is ambiguous"). Renamed to `what_ref`.
-- Parameter names cannot change in place, so the function is dropped and recreated.
-- Down: recreate the 0002 version (it never worked, so there is nothing to restore).

drop function app.award_xp(uuid, uuid, text, text);

create function app.award_xp(ws uuid, uid uuid, what text, what_ref text)
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
  values (ws, uid, what, what_ref, pts)
  on conflict (workspace_id, kind, ref) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 and uid is not null then
    perform app.bump_streak(ws, uid);
  end if;
  return inserted = 1;
end;
$$;

revoke all on function app.award_xp(uuid, uuid, text, text) from public, anon, authenticated;
