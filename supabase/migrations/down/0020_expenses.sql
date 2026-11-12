select cron.unschedule('recurring-costs-daily');
drop policy if exists receipts_read on storage.objects;
drop policy if exists receipts_write on storage.objects;
drop policy if exists receipts_delete on storage.objects;
-- The bucket is left in place if it holds files; empty it first to remove it.
delete from storage.buckets where id = 'receipts' and not exists (select 1 from storage.objects where bucket_id = 'receipts');
drop trigger if exists seed_expense_categories on public.workspaces;
drop table if exists public.expenses, public.recurring_costs, public.expense_categories;
drop function if exists public.run_recurring_costs(date);
drop function if exists app.next_occurrence(date, text, smallint);
drop function if exists app.on_expense_logged();
drop function if exists app.on_workspace_created_expenses();
drop function if exists app.seed_expense_categories(uuid);
drop function if exists app.folder_workspace(text);
