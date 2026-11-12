-- 0013_jobs_schedule: pg_cron calls the app's job routes. Vercel's free plan only allows
-- daily crons, so the database is the clock.
-- Secrets live in Supabase Vault:
--   jobs_secret: generated here, never printed. Copy it from Vault into Vercel as JOBS_SECRET.
--   site_url:    the public address the jobs are sent to.
-- Down: select cron.unschedule('outbox-every-minute'); drop function app.call_job(text);
--       delete from vault.secrets where name in ('jobs_secret', 'site_url');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'jobs_secret') then
    perform vault.create_secret(
      translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_'),
      'jobs_secret',
      'Bearer secret for /api/jobs/*. Must equal JOBS_SECRET in Vercel.');
  end if;
  if not exists (select 1 from vault.secrets where name = 'site_url') then
    perform vault.create_secret('https://business.ascsoftware.co.za', 'site_url', 'Public site address for scheduled jobs.');
  end if;
end $$;

/** Posts to /api/jobs/<job>. For the outbox, only when something is actually due. */
create or replace function app.call_job(job text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if job = 'outbox' and not exists (
    select 1 from public.outbox where status = 'pending' and next_attempt_at <= now()
  ) and not exists (
    select 1 from public.outbox where status = 'sending' and next_attempt_at < now() - interval '10 minutes'
  ) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'site_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'jobs_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url || '/api/jobs/' || job,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000);
end;
$$;
revoke all on function app.call_job(text) from public, anon, authenticated;

select cron.schedule('outbox-every-minute', '* * * * *', $cron$select app.call_job('outbox')$cron$);
