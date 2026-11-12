-- Reverses 0055_integration_schedule.
select cron.unschedule('shipment-tracking-30-min');
select cron.unschedule('shopify-sync-6-hourly');
select cron.unschedule('integrations-every-minute');
drop function if exists public.queue_shipment_tracking();
drop function if exists public.queue_shopify_syncs();
