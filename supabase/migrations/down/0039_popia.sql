-- Down for 0039_popia.
select cron.unschedule('purge-daily');
drop function if exists public.export_workspace(uuid);
drop function if exists public.purge_due();
drop function if exists public.cancel_account_deletion();
drop function if exists public.request_account_deletion();
drop function if exists public.cancel_workspace_deletion(uuid);
drop function if exists public.request_workspace_deletion(uuid);
alter table public.profiles drop column if exists deletion_requested_at;
alter table public.workspaces drop column if exists deletion_requested_by, drop column if exists deletion_requested_at;
drop table if exists public.consents;
