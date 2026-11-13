-- Down for 0034_ai.
drop function if exists public.ai_status(uuid);
drop function if exists public.ai_release(uuid);
drop function if exists public.ai_take(uuid, text);
drop table if exists public.ai_global_daily, public.ai_usage;
alter table public.workspace_settings drop column if exists ai_enabled;
