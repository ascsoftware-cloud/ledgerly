drop function if exists public.invoice_time_entries(uuid, uuid[]);
drop function if exists public.stop_timer(uuid);
drop function if exists public.start_timer(uuid, uuid, uuid, text);
drop table if exists public.time_entries;
