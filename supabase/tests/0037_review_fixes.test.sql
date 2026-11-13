-- Tests for 0037_review_fixes. Ends by raising "REVIEW FIX TESTS: n passed, m failed" (rolls back).
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
  n int; res jsonb; uid1 uuid; g1 int; g2 int; t text;
  olga uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws_b uuid; ws2 uuid; c uuid; cb uuid; rule uuid;
  sast_day date := (now() at time zone 'Africa/Johannesburg')::date;
  at_10 timestamptz; at_02 timestamptz;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@fix.test'), (sam, 'sam@fix.test'), (eve, 'eve@fix.test');
  insert into public.workspaces (slug, name, created_by) values ('fix-test-a', 'A', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('fix-test-b', 'B', olga) returning id into ws_b;
  insert into public.workspaces (slug, name, created_by) values ('fix-test-c', 'C', eve) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner'), (ws, sam, 'staff'), (ws_b, olga, 'owner'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id, ai_enabled) values (ws, true), (ws_b, false), (ws2, true);
  at_10 := (sast_day::timestamp + interval '10 hours') at time zone 'Africa/Johannesburg';
  at_02 := (sast_day::timestamp + interval '2 hours') at time zone 'Africa/Johannesburg';

  -- 1. AI allowance functions are for the server only
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select public.ai_take('%s', '%s', 'chat')$q$, ws, sam)) = -1 then 'PASS' else 'FAIL' end || ' a signed-in person cannot call ai_take over the API');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select public.ai_release('%s', '%s')$q$, gen_random_uuid(), sam)) = -1 then 'PASS' else 'FAIL' end || ' nor ai_release');
  r := r || (case when pg_temp.probe('anon', null, format($q$select public.ai_take('%s', '%s', 'chat')$q$, ws, sam)) = -1 then 'PASS' else 'FAIL' end || ' nor the public');
  select requests into g1 from public.ai_global_daily where day = app.sast_today();
  g1 := coalesce(g1, 0);
  res := public.ai_take(ws, sam, 'chat');
  r := r || (case when (res ->> 'used')::int = 1 and (res ->> 'limit')::int = 20 then 'PASS' else 'FAIL' end || ' the server can take one for a member (' || res::text || ')');
  r := r || (case when (select requests from public.ai_global_daily where day = app.sast_today()) = g1 + 1 then 'PASS' else 'FAIL' end || ' and the service-wide count goes up');
  begin
    perform public.ai_take(ws, eve, 'chat');
    r := r || 'FAIL a non-member used this business''s allowance'::text;
  exception when no_data_found then
    r := r || 'PASS someone who is not a member cannot use the allowance'::text;
  end;
  begin
    perform public.ai_take(ws_b, olga, 'chat');
    r := r || 'FAIL a switched-off business was allowed'::text;
  exception when sqlstate 'LDG03' then
    r := r || 'PASS a switched-off business is refused'::text;
  end;
  uid1 := (res ->> 'usage_id')::uuid;
  perform public.ai_release(uid1, eve);
  r := r || (case when (select count(*) from public.ai_usage where id = uid1) = 1 then 'PASS' else 'FAIL' end || ' someone else cannot release it');
  perform public.ai_release(uid1, sam);
  r := r || (case when (select count(*) from public.ai_usage where id = uid1) = 0 then 'PASS' else 'FAIL' end || ' its maker can, when the provider failed');
  select requests into g2 from public.ai_global_daily where day = app.sast_today();
  r := r || (case when g2 = g1 then 'PASS' else 'FAIL' end || ' and the service-wide count is given back too (' || g1 || ' -> ' || g2 || ')');
  perform public.ai_release(uid1, sam);
  select requests into g2 from public.ai_global_daily where day = app.sast_today();
  r := r || (case when g2 = g1 then 'PASS' else 'FAIL' end || ' releasing twice gives back nothing more');

  -- 2. A push subscription moves to whoever subscribes on that device
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.save_push_subscription('https://push.example/device-1', 'p256-a', 'auth-a', 'Phone');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when (select user_id from public.push_subscriptions where endpoint = 'https://push.example/device-1') = sam then 'PASS' else 'FAIL' end || ' a person can save their device');
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.save_push_subscription('https://push.example/device-1', 'p256-b', 'auth-b', 'Phone');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.push_subscriptions where endpoint = 'https://push.example/device-1';
  r := r || (case when n = 1 and (select user_id from public.push_subscriptions where endpoint = 'https://push.example/device-1') = olga then 'PASS' else 'FAIL' end || ' the next person to sign in on that phone takes it over (' || n || ' row)');
  r := r || (case when pg_temp.probe('anon', null, $q$select public.save_push_subscription('https://push.example/x', 'a', 'b', 'c')$q$) = -1 then 'PASS' else 'FAIL' end || ' the public cannot subscribe');

  -- 3. The daily summary is one per business
  insert into public.contacts (workspace_id, name, email) values (ws, 'Debtor A', 'a@debtor.test') returning id into c;
  insert into public.contacts (workspace_id, name, email) values (ws_b, 'Debtor B', 'b@debtor.test') returning id into cb;
  insert into public.sales_documents (workspace_id, kind, status, number, contact_id, due_date, total_cents) values (ws, 'invoice', 'sent', 'INV-1', c, sast_day - 5, 10000);
  insert into public.sales_documents (workspace_id, kind, status, number, contact_id, due_date, total_cents) values (ws_b, 'invoice', 'sent', 'INV-1', cb, sast_day - 5, 20000);
  perform app.daily_reminders();
  select count(*) into n from public.notifications where user_id = olga and kind = 'daily';
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' someone who owns two businesses hears about both (' || n || ')');
  perform app.daily_reminders();
  select count(*) into n from public.notifications where user_id = olga and kind = 'daily';
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' and running it again adds nothing (' || n || ')');

  -- 4. Automations only act from the day the rule is made, and "overdue" means after the due date
  delete from public.sales_documents where workspace_id = ws;
  insert into public.sales_documents (workspace_id, kind, status, number, contact_id, due_date, total_cents) values
    (ws, 'invoice', 'sent', 'OLD-1', c, sast_day - 20, 10000),
    (ws, 'invoice', 'sent', 'NEW-3', c, sast_day - 3, 10000),
    (ws, 'invoice', 'sent', 'TODAY', c, sast_day, 10000);
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Three days', 'invoice_overdue', 3, 'notify_me') returning id into rule;
  perform app.evaluate_rules(at_10);
  select count(*) into n from public.automation_runs where rule_id = rule;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a new rule acts on the invoice that just reached 3 days, not on the old backlog (' || n || ')');
  select coalesce(string_agg(ref_key, ','), '') into t from public.automation_runs ar where rule_id = rule and exists (select 1 from public.sales_documents d where d.id::text = ar.ref_key and d.number = 'NEW-3');
  r := r || (case when t <> '' then 'PASS' else 'FAIL' end || ' and it is the right one');

  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Zero days', 'invoice_overdue', 0, 'notify_me') returning id into rule;
  perform app.evaluate_rules(at_10);
  select count(*) into n from public.automation_runs ar where rule_id = rule and exists (select 1 from public.sales_documents d where d.id::text = ar.ref_key and d.number = 'TODAY');
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' "0 days overdue" does not include an invoice that is only due today (' || n || ')');
  select count(*) into n from public.automation_runs ar where rule_id = rule and exists (select 1 from public.sales_documents d where d.id::text = ar.ref_key and d.number = 'NEW-3');
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' nor one that went overdue before the rule was made (' || n || ')');
  update public.sales_documents set due_date = sast_day - 1 where number = 'TODAY' and workspace_id = ws;
  perform app.evaluate_rules(at_10);
  select count(*) into n from public.automation_runs ar where rule_id = rule and exists (select 1 from public.sales_documents d where d.id::text = ar.ref_key and d.number = 'TODAY');
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' but it does once it is a day late (' || n || ')');

  -- Tasks follow the same rule
  insert into public.tasks (workspace_id, title, due_date) values (ws, 'Due today', sast_day), (ws, 'Late by a day', sast_day - 1);
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Tasks', 'task_overdue', 0, 'notify_me') returning id into rule;
  perform app.evaluate_rules(at_10);
  select count(*) into n from public.automation_runs where rule_id = rule;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' only the task that is actually overdue is picked up (' || n || ')');

  -- Client emails only in working hours
  delete from public.automation_rules where workspace_id = ws;
  delete from public.automation_runs where workspace_id = ws;
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Email', 'invoice_overdue', 3, 'send_reminder') returning id into rule;
  perform app.evaluate_rules(at_02);
  select count(*) into n from public.outbox where workspace_id = ws and template = 'reminder';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' no client email at 02:00 (' || n || ')');
  perform app.evaluate_rules(at_10);
  select count(*) into n from public.outbox where workspace_id = ws and template = 'reminder';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' it goes out at 10:00 (' || n || ')');
  perform app.evaluate_rules(at_10 + interval '1 hour');
  select count(*) into n from public.outbox where workspace_id = ws and template = 'reminder';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and only once (' || n || ')');

  -- The run log shows people-friendly text only
  select count(*) into n from public.automation_runs where workspace_id = ws and detail ~* '(violates|constraint|relation|column|sqlstate)';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' the log never shows raw database text');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'REVIEW FIX TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
