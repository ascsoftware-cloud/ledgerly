-- 0005_rate_limits: fixed-window counters for sign-in and public endpoints.
-- Platform table: no workspace_id (requests are not tied to a workspace yet).
-- Buckets hold a kind and a SHA-256 hash, never a raw email or IP address.
-- Down: drop function public.hit_rate_limit(text, integer, integer); drop table public.rate_limits;

create table public.rate_limits (
  bucket text not null check (bucket ~ '^[a-z-]{2,30}:[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 1 check (hits > 0),
  primary key (bucket, window_start)
);
create index rate_limits_window_start_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
-- No policies: only the function below (running as its owner) touches this table.

/** Counts one hit; true while the bucket is within `max_hits` for the current window. */
create or replace function public.hit_rate_limit(p_bucket text, max_hits integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  win timestamptz;
  total integer;
begin
  if max_hits < 1 or window_seconds < 1 or window_seconds > 86400 then
    raise exception 'Bad rate limit arguments' using errcode = 'check_violation';
  end if;
  win := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);

  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, win, 1)
  on conflict (bucket, window_start) do update set hits = rl.hits + 1
  returning rl.hits into total;

  -- Tidy up now and then, so the table stays small without a scheduled job.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return total <= max_hits;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
