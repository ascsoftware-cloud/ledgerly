-- Down for 0033_automations. (app.call_job keeps its push branch; re-run 0013's body to remove it.)
select cron.unschedule('push-every-minute');
select cron.unschedule('automations-hourly');
drop function if exists app.evaluate_rules(timestamptz);
drop function if exists app.rule_matches(uuid, text, integer, timestamptz, date);
drop table if exists public.automation_runs, public.automation_rules;
drop function if exists app.guard_rule_count();
