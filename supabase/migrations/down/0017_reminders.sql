select cron.unschedule('reminders-daily');
drop function if exists public.queue_due_reminders();
alter table public.workspace_settings drop column if exists auto_reminders;
