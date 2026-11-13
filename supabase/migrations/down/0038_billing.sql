-- Down for 0038_billing. (app.evaluate_rules keeps its Pro-only join; re-run 0037's body to remove it.)
select cron.unschedule('expire-subscriptions');
drop function if exists public.show_footer_for_portal(text);
drop function if exists public.show_footer_for_document(text);
drop function if exists public.workspace_usage(uuid);
drop function if exists public.storage_room(uuid, bigint);
drop function if exists public.create_additional_workspace(text);
drop trigger if exists guard_portal_plan on public.portal_links;
drop function if exists app.guard_portal_plan();
drop trigger if exists guard_rule_plan on public.automation_rules;
drop function if exists app.guard_rule_plan();
drop function if exists app.expire_subscriptions();
drop function if exists public.billing_get_token(uuid, uuid);
drop function if exists public.billing_set_cancelling(uuid, text);
drop function if exists public.billing_apply_payment(uuid, text, text, integer);
drop function if exists public.billing_start_checkout(uuid, uuid, integer);
drop table if exists public.billing_events, public.billing_checkouts, public.subscriptions;
