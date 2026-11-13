-- Down for 0041_ai_on_by_default. (Rows already switched on stay on.)
alter table public.workspace_settings alter column ai_enabled set default false;
