-- 0041_ai_on_by_default: Miko (the AI helper) is on for every business unless an owner or admin switches it off.
-- Down script: supabase/migrations/down/0041_ai_on_by_default.sql
-- Decided by the owner: it was off until switched on (0034). The caps (20 a month Free, 300 Pro, and the daily
-- service-wide limit) and the owner/admin switch are unchanged.
alter table public.workspace_settings alter column ai_enabled set default true;
update public.workspace_settings set ai_enabled = true where ai_enabled = false;
