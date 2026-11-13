-- Re-run public.start_timer from 0023_time.sql and app.task_rules from 0022_work.sql, then:
drop trigger if exists unassign_on_leave on public.memberships;
drop function if exists app.unassign_on_leave();
drop function if exists public.reset_bank_line(uuid);
drop function if exists public.delete_bank_import(uuid);
grant delete on public.bank_imports to authenticated;
