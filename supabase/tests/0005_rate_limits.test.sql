-- Tests for 0005_rate_limits. Ends by raising "RATE LIMIT TESTS: n passed, m failed".
do $$
declare
  r text[] := '{}';
  ok boolean;
  b text := 'otp-email:' || repeat('a', 64);
  other text := 'otp-email:' || repeat('b', 64);
  passed int;
  failed int;
begin
  set local role service_role;
  r := r || (case when public.hit_rate_limit(b, 3, 600) then 'PASS' else 'FAIL' end || ' 1st request allowed');
  r := r || (case when public.hit_rate_limit(b, 3, 600) then 'PASS' else 'FAIL' end || ' 2nd request allowed');
  r := r || (case when public.hit_rate_limit(b, 3, 600) then 'PASS' else 'FAIL' end || ' 3rd request allowed');
  r := r || (case when not public.hit_rate_limit(b, 3, 600) then 'PASS' else 'FAIL' end || ' 4th request in the window refused');
  r := r || (case when not public.hit_rate_limit(b, 3, 600) then 'PASS' else 'FAIL' end || ' still refused after that');
  r := r || (case when public.hit_rate_limit(other, 3, 600) then 'PASS' else 'FAIL' end || ' another email is unaffected');
  reset role;

  -- A full bucket in an earlier window does not count against the current one.
  update public.rate_limits set window_start = window_start - interval '1 hour' where bucket = b;
  set local role service_role;
  r := r || (case when public.hit_rate_limit(b, 3, 600) then 'PASS' else 'FAIL' end || ' allowed again in the next window');
  begin
    perform public.hit_rate_limit('raw@email.test', 3, 600);
    r := r || 'FAIL a raw email cannot be stored as a bucket'::text;
  exception when check_violation then r := r || 'PASS a raw email cannot be stored as a bucket'::text;
  end;
  reset role;

  set local role anon;
  begin
    perform public.hit_rate_limit(b, 1000, 600);
    r := r || 'FAIL signed-out visitors cannot call it'::text;
  exception when insufficient_privilege then r := r || 'PASS signed-out visitors cannot call it'::text;
  end;
  begin
    perform count(*) from public.rate_limits;
    r := r || 'FAIL signed-out visitors cannot read the counters'::text;
  exception when insufficient_privilege then r := r || 'PASS signed-out visitors cannot read the counters'::text;
  end;
  reset role;

  set local role authenticated;
  begin
    perform public.hit_rate_limit(b, 1000, 600);
    r := r || 'FAIL signed-in users cannot call it'::text;
  exception when insufficient_privilege then r := r || 'PASS signed-in users cannot call it'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%')
    into passed, failed from unnest(r) as x;
  raise exception E'RATE LIMIT TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
