-- 0055_integration_schedule: pg_cron drives the integrations worker, like the outbox (0013).
-- Down script: supabase/migrations/down/0055_integration_schedule.sql

/** Every six hours: re-read each connected Shopify store, in case a webhook was missed. */
create or replace function public.queue_shopify_syncs()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(public.enqueue_integration_job(c.id, 'shopify_sync', null, '{"full": false}'::jsonb,
                                              'shopify:' || c.id || ':sync', 0))::int
  from public.integration_connections c
  where c.provider = 'shopify' and c.status = 'active';
$$;

/** Every 30 minutes: track parcels that are on their way (for at most 30 days). */
create or replace function public.queue_shipment_tracking()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(public.enqueue_integration_job(s.connection_id, 'track_shipment', s.id, '{}'::jsonb,
                                              'courier_guy:track:' || s.id, 0))::int
  from public.shipments s
  join public.integration_connections c on c.id = s.connection_id and c.status = 'active'
  where s.status in ('booked', 'in_transit') and s.created_at > now() - interval '30 days';
$$;

revoke all on function public.queue_shopify_syncs() from public, anon, authenticated;
revoke all on function public.queue_shipment_tracking() from public, anon, authenticated;
grant execute on function public.queue_shopify_syncs() to service_role;
grant execute on function public.queue_shipment_tracking() to service_role;

-- The worker is called only when something is due, so idle minutes cost nothing.
select cron.schedule('integrations-every-minute', '* * * * *',
  $cron$select app.call_job('integrations') where exists (
    select 1 from public.integration_jobs
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'running' and next_attempt_at < now() - interval '10 minutes'))$cron$);
select cron.schedule('shopify-sync-6-hourly', '17 */6 * * *', $cron$select public.queue_shopify_syncs()$cron$);
select cron.schedule('shipment-tracking-30-min', '*/30 * * * *', $cron$select public.queue_shipment_tracking()$cron$);
