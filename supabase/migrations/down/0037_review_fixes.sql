-- Down for 0037_review_fixes. Drops the new functions; re-run the 0034 function bodies (ai_take, ai_release),
-- 0032's daily_reminders and 0033's rule_matches/evaluate_rules to restore the earlier behaviour.
drop function if exists public.save_push_subscription(text, text, text, text);
drop function if exists public.ai_release(uuid, uuid);
drop function if exists public.ai_take(uuid, uuid, text);
drop function if exists app.rule_matches(uuid, text, integer, timestamptz, date, date);
