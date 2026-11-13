-- 0036_phase6_index: the performance advisor flagged automation_runs' composite foreign key (workspace_id, rule_id).
-- Down script: supabase/migrations/down/0036_phase6_index.sql
create index automation_runs_rule_idx on public.automation_runs (workspace_id, rule_id);
