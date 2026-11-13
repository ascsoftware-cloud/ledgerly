-- Tests for 0034_ai (as changed by 0037: ai_take / ai_release are for the server only and take the person explicitly).
-- Ends by raising "AI TESTS: n passed, m failed" (rolls back).
create function pg_temp.probe(who text, uid uuid, q text) returns int language plpgsql as $f$
declare n int;
begin
  perform set_config('request.jwt.claims', case when uid is null then json_build_object('role', who)::text
                                                else json_build_object('sub', uid, 'role', who)::text end, true);
  execute format('set local role %I', who);
  begin
    execute q;
    get diagnostics n = row_count;
  exception when others then
    n := -1;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return n;
end
$f$;

do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb; uid1 uuid; msg text;
  olga uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws2 uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@ai.test'), (sam, 'sam@ai.test'), (acc, 'acc@ai.test'), (eve, 'eve@ai.test');
  insert into public.workspaces (slug, name, created_by) values ('ai-test-a', 'A', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('ai-test-b', 'B', eve) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws2);

  -- off by default; only owners and admins switch it on
  select ai_enabled::text into t from public.workspace_settings where workspace_id = ws;
  r := r || (case when t = 'false' then 'PASS' else 'FAIL' end || ' AI is off until someone switches it on');
  begin
    perform public.ai_take(ws, sam, 'chat');
    r := r || 'FAIL a request was allowed while AI was off'::text;
  exception when sqlstate 'LDG03' then
    r := r || 'PASS and a request is refused while it is off'::text;
  end;
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$update public.workspace_settings set ai_enabled = true where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' staff cannot switch it on');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$update public.workspace_settings set ai_enabled = true where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' nor can another business');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$update public.workspace_settings set ai_enabled = true where workspace_id = '%s'$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' an owner can');

  -- who may ask, and what they are counted against
  res := public.ai_take(ws, sam, 'chat');
  r := r || (case when (res ->> 'used')::int = 1 and (res ->> 'limit')::int = 20 and (res ->> 'usage_id') is not null then 'PASS' else 'FAIL' end || ' any member can ask, and the Free plan allows 20 a month (' || res::text || ')');
  begin
    perform public.ai_take(ws, eve, 'chat');
    r := r || 'FAIL someone from another business used this one''s allowance'::text;
  exception when no_data_found then
    r := r || 'PASS someone from another business cannot use this one''s allowance'::text;
  end;
  begin
    perform public.ai_take(ws, sam, 'nonsense');
    r := r || 'FAIL an unknown kind of request was allowed'::text;
  exception when sqlstate 'LDG03' then
    r := r || 'PASS an unknown kind of request is refused'::text;
  end;
  r := r || (case when pg_temp.probe('anon', null, format($q$select public.ai_take('%s', '%s', 'chat')$q$, ws, sam)) = -1 then 'PASS' else 'FAIL' end || ' the public cannot ask');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select public.ai_take('%s', '%s', 'chat')$q$, ws, sam)) = -1 then 'PASS' else 'FAIL' end || ' and a signed-in person cannot call it directly: only the server can');

  -- the monthly cap is shared by the whole workspace
  for n in 2..20 loop
    perform public.ai_take(ws, olga, 'chat');
  end loop;
  select count(*) into n from public.ai_usage where workspace_id = ws;
  r := r || (case when n = 20 then 'PASS' else 'FAIL' end || ' twenty requests are counted (' || n || ')');
  begin
    perform public.ai_take(ws, sam, 'chat');
    r := r || 'FAIL the 21st request was allowed'::text;
  exception when sqlstate 'LDG01' then
    get stacked diagnostics msg = message_text;
    r := r || (case when msg like '%20%' then 'PASS' else 'FAIL' end || ' the 21st is refused with the limit named (' || msg || ')');
  end;

  -- a failed request is given back
  select id, user_id into uid1, t from public.ai_usage where workspace_id = ws order by created_at limit 1;
  perform public.ai_release(uid1, eve);
  select count(*) into n from public.ai_usage where workspace_id = ws;
  r := r || (case when n = 20 then 'PASS' else 'FAIL' end || ' someone else cannot release it, so the count stays at 20');
  perform public.ai_release(uid1, t::uuid);
  perform public.ai_release(uid1, t::uuid);
  select count(*) into n from public.ai_usage where workspace_id = ws;
  r := r || (case when n = 19 then 'PASS' else 'FAIL' end || ' the person whose request failed gets it back, once (' || n || ')');
  res := public.ai_take(ws, sam, 'receipt');
  r := r || (case when (res ->> 'used')::int = 20 then 'PASS' else 'FAIL' end || ' and can use it again');
  update public.ai_usage set created_at = created_at - interval '40 days' where workspace_id = ws and id in (select id from public.ai_usage where workspace_id = ws limit 5);
  select count(*) into n from public.ai_usage where workspace_id = ws and created_at >= date_trunc('month', now() at time zone 'Africa/Johannesburg');
  r := r || (case when n <= 15 then 'PASS' else 'FAIL' end || ' last month''s requests do not count against this month');

  -- the status for the settings screen
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.ai_status(ws);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when (res ->> 'enabled')::boolean and (res ->> 'limit')::int = 20 then 'PASS' else 'FAIL' end || ' members can see whether it is on and the limit (' || res::text || ')');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select public.ai_status('%s')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' but only their own business''s');

  -- Pro gets more; the global daily cap protects the free quota
  update public.workspaces set plan = 'pro' where id = ws;
  res := public.ai_take(ws, olga, 'chat');
  r := r || (case when (res ->> 'limit')::int = 300 then 'PASS' else 'FAIL' end || ' the Pro plan allows 300 (' || (res ->> 'limit') || ')');
  insert into public.ai_global_daily (day, requests) values (app.sast_today(), 1000) on conflict (day) do update set requests = 1000;
  begin
    perform public.ai_take(ws, olga, 'chat');
    r := r || 'FAIL a request was allowed past the daily cap'::text;
  exception when sqlstate 'LDG01' then
    r := r || 'PASS once the whole service has reached its daily cap, requests are refused politely'::text;
  end;

  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.ai_usage (workspace_id, user_id, kind) values ('%s', '%s', 'chat')$q$, ws, olga)) = -1 then 'PASS' else 'FAIL' end || ' usage cannot be written by hand');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select 1 from public.ai_usage where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' staff do not see who asked what');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$select 1 from public.ai_usage where workspace_id = '%s'$q$, ws)) > 0 then 'PASS' else 'FAIL' end || ' owners can see usage');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'AI TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
