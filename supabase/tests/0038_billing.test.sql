-- Tests for 0038_billing. Ends by raising "BILLING TESTS: n passed, m failed" (rolls back).
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
  n int; n2 int; t text; res jsonb; ck uuid; pe timestamptz;
  olga uuid := gen_random_uuid(); adam uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws2 uuid; c uuid; doc uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@bill.test'), (adam, 'adam@bill.test'), (sam, 'sam@bill.test'), (eve, 'eve@bill.test');
  insert into public.workspaces (slug, name, created_by) values ('bill-test-a', 'A', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('bill-test-b', 'B', eve) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner'), (ws, adam, 'admin'), (ws, sam, 'staff'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws2);
  insert into public.contacts (workspace_id, name, email) values (ws, 'Client', 'c@client.test') returning id into c;
  insert into public.sales_documents (workspace_id, kind, status, number, contact_id, public_token) values (ws, 'invoice', 'sent', 'INV-1', c, 'tok-bill-a-12345678901234567890') returning id into doc;

  -- Free to start; nobody can change the plan by hand
  select plan into t from public.workspaces where id = ws;
  r := r || (case when t = 'free' then 'PASS' else 'FAIL' end || ' a workspace starts on Free');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$update public.workspaces set plan = 'pro' where id = '%s'$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' the owner cannot make it Pro by hand');

  -- Only the server may run billing, and only owners start a checkout
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$select public.billing_start_checkout('%s', '%s', 19900)$q$, ws, olga)) = -1 then 'PASS' else 'FAIL' end || ' a signed-in person cannot run billing functions');
  r := r || (case when pg_temp.probe('anon', null, format($q$select public.billing_apply_payment(null, 'tok', 'pf-x', 19900)$q$)) = -1 then 'PASS' else 'FAIL' end || ' nor the public');
  begin
    perform public.billing_start_checkout(ws, adam, 19900);
    r := r || 'FAIL an admin started a checkout'::text;
  exception when sqlstate 'LDG03' then
    r := r || 'PASS only the owner can start an upgrade'::text;
  end;
  begin
    perform public.billing_start_checkout(ws, eve, 19900);
    r := r || 'FAIL another business''s owner started one'::text;
  exception when sqlstate 'LDG03' then
    r := r || 'PASS and not someone from another business'::text;
  end;
  ck := public.billing_start_checkout(ws, olga, 19900);
  r := r || (case when ck is not null then 'PASS' else 'FAIL' end || ' the owner can');

  -- Limits while on Free
  begin
    insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'x', 'invoice_overdue', 3, 'notify_me');
    r := r || 'FAIL a Free workspace made an automation'::text;
  exception when sqlstate 'LDG01' then
    r := r || 'PASS automations need Pro'::text;
  end;
  begin
    insert into public.portal_links (workspace_id, contact_id) values (ws, c);
    r := r || 'FAIL a Free workspace made a portal link'::text;
  exception when sqlstate 'LDG01' then
    r := r || 'PASS the portal needs Pro'::text;
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.create_additional_workspace('Second');
    reset role;
    r := r || 'FAIL a Free owner made a second business'::text;
  exception when sqlstate 'LDG01' then
    reset role;
    r := r || 'PASS a second business needs Pro'::text;
  end;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when public.show_footer_for_document('tok-bill-a-12345678901234567890') then 'PASS' else 'FAIL' end || ' Free documents carry the "Sent with Ledgerly" footer');
  r := r || (case when public.show_footer_for_document('nonsense') then 'PASS' else 'FAIL' end || ' and an unknown link shows it too');

  -- Payments: a wrong amount is refused; an unknown checkout is unknown
  begin
    perform public.billing_apply_payment(ck, 'tok-1', 'pf-bad', 100);
    r := r || 'FAIL a payment of the wrong amount was accepted'::text;
  exception when check_violation then
    r := r || 'PASS a payment of the wrong amount is refused'::text;
  end;
  t := public.billing_apply_payment(gen_random_uuid(), 'nope', 'pf-unknown', 19900);
  r := r || (case when t = 'unknown' then 'PASS' else 'FAIL' end || ' a payment for a checkout we never made is unknown (' || t || ')');
  select plan into t from public.workspaces where id = ws;
  r := r || (case when t = 'free' then 'PASS' else 'FAIL' end || ' and neither changed the plan');

  -- The first payment activates Pro for a month
  t := public.billing_apply_payment(ck, 'tok-1', 'pf-1', 19900);
  r := r || (case when t = 'activated' then 'PASS' else 'FAIL' end || ' the first payment activates Pro (' || t || ')');
  select plan into t from public.workspaces where id = ws;
  select current_period_end into pe from public.subscriptions where workspace_id = ws;
  r := r || (case when t = 'pro' and pe between now() + interval '27 days' and now() + interval '32 days' then 'PASS' else 'FAIL' end || ' the workspace is Pro for about a month (' || t || ', ' || pe::date || ')');
  t := public.billing_apply_payment(ck, 'tok-1', 'pf-1', 19900);
  r := r || (case when t = 'duplicate' then 'PASS' else 'FAIL' end || ' the same notification twice is one payment (' || t || ')');
  r := r || (case when (select current_period_end from public.subscriptions where workspace_id = ws) = pe then 'PASS' else 'FAIL' end || ' and does not extend it again');
  begin
    perform public.billing_start_checkout(ws, olga, 19900);
    r := r || 'FAIL a second checkout while active'::text;
  exception when sqlstate 'LDG03' then
    r := r || 'PASS no second checkout while Pro is active'::text;
  end;

  -- A recurring payment (found by its token) adds another month
  t := public.billing_apply_payment(null, 'tok-1', 'pf-2', 19900);
  r := r || (case when t = 'extended' then 'PASS' else 'FAIL' end || ' the next month''s payment extends it (' || t || ')');
  r := r || (case when (select current_period_end from public.subscriptions where workspace_id = ws) between pe + interval '27 days' and pe + interval '32 days' then 'PASS' else 'FAIL' end || ' by one month');
  begin
    perform public.billing_apply_payment(null, 'tok-1', 'pf-3', 5000);
    r := r || 'FAIL a recurring payment of the wrong amount was accepted'::text;
  exception when check_violation then
    r := r || 'PASS a recurring payment of the wrong amount is refused'::text;
  end;

  -- Who can see the subscription
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$select status from public.subscriptions where workspace_id = '%s'$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' the owner can see its status');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$select token from public.subscriptions where workspace_id = '%s'$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' but never the PayFast token');
  r := r || (case when pg_temp.probe('authenticated', adam, format($q$select status from public.subscriptions where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' an admin sees nothing');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select status from public.subscriptions where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' nor does another business');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$update public.subscriptions set current_period_end = now() + interval '10 years' where workspace_id = '%s'$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' nobody can edit it');
  r := r || (case when public.billing_get_token(ws, olga) = 'tok-1' and public.billing_get_token(ws, adam) is null then 'PASS' else 'FAIL' end || ' only the server, for the owner, can read the token');

  -- Pro unlocks the Pro things
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Chase', 'invoice_overdue', 3, 'notify_me');
  r := r || 'PASS automations work on Pro'::text;
  insert into public.portal_links (workspace_id, contact_id) values (ws, c);
  r := r || 'PASS and so does the portal'::text;
  r := r || (case when not public.show_footer_for_document('tok-bill-a-12345678901234567890') then 'PASS' else 'FAIL' end || ' Pro documents drop the footer');
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.create_additional_workspace('  Second Shop  ');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when (res ->> 'slug') like 'secondshop-%' then 'PASS' else 'FAIL' end || ' a Pro owner can add another business (' || res::text || ')');
  select count(*) into n from public.memberships where workspace_id = (res ->> 'id')::uuid and user_id = olga and role = 'owner';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and owns it');
  select plan into t from public.workspaces where id = (res ->> 'id')::uuid;
  r := r || (case when t = 'free' then 'PASS' else 'FAIL' end || ' on Free until upgraded');
  r := r || (case when pg_temp.probe('authenticated', olga, $q$select public.create_additional_workspace('   ')$q$) = -1 then 'PASS' else 'FAIL' end || ' a blank name is refused');
  r := r || (case when pg_temp.probe('authenticated', sam, $q$select public.create_additional_workspace('Sneaky')$q$) = -1 then 'PASS' else 'FAIL' end || ' someone who owns no Pro business cannot');
  r := r || (case when pg_temp.probe('anon', null, $q$select public.create_additional_workspace('X')$q$) = -1 then 'PASS' else 'FAIL' end || ' nor the public');

  -- Cancelling keeps Pro until the paid period ends, then Free, and the data stays
  r := r || (case when public.billing_set_cancelling(ws, null) then 'PASS' else 'FAIL' end || ' the owner can cancel');
  select plan into t from public.workspaces where id = ws;
  r := r || (case when t = 'pro' and (select status from public.subscriptions where workspace_id = ws) = 'cancelling' then 'PASS' else 'FAIL' end || ' Pro stays while the paid month runs');
  n := app.expire_subscriptions();
  select plan into t from public.workspaces where id = ws;
  r := r || (case when t = 'pro' and n = 0 then 'PASS' else 'FAIL' end || ' and the daily job leaves it alone');
  update public.subscriptions set current_period_end = now() - interval '1 hour' where workspace_id = ws;
  n := app.expire_subscriptions();
  select plan into t from public.workspaces where id = ws;
  r := r || (case when t = 'free' and n = 1 then 'PASS' else 'FAIL' end || ' once the month is over it returns to Free (' || t || ')');
  select count(*) into n from public.sales_documents where workspace_id = ws;
  select count(*) into n2 from public.contacts where workspace_id = ws;
  r := r || (case when n = 1 and n2 = 1 then 'PASS' else 'FAIL' end || ' and nothing is deleted');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$select * from public.sales_documents where workspace_id = '%s'$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' or hidden: viewing still works');
  n := (select count(*) from public.automation_rules where workspace_id = ws);
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' automations are kept');
  update public.sales_documents set due_date = (now() at time zone 'Africa/Johannesburg')::date - 5 where id = doc;
  update public.automation_rules set created_at = now() - interval '90 days' where workspace_id = ws;
  perform app.evaluate_rules(now());
  select count(*) into n from public.automation_runs where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' but they stop running on Free');
  begin
    perform public.billing_start_checkout(ws, olga, 19900);
    r := r || 'PASS and the owner can upgrade again'::text;
  exception when others then
    r := r || 'FAIL could not upgrade again'::text;
  end;

  -- A late payer is downgraded after 3 days' grace
  perform public.billing_apply_payment((select id from public.billing_checkouts where workspace_id = ws order by created_at desc limit 1), 'tok-2', 'pf-9', 19900);
  update public.subscriptions set current_period_end = now() - interval '2 days' where workspace_id = ws;
  perform app.expire_subscriptions();
  select plan into t from public.workspaces where id = ws;
  r := r || (case when t = 'pro' then 'PASS' else 'FAIL' end || ' a payment 2 days late keeps Pro (grace)');
  update public.subscriptions set current_period_end = now() - interval '4 days' where workspace_id = ws;
  perform app.expire_subscriptions();
  select plan into t from public.workspaces where id = ws;
  r := r || (case when t = 'free' then 'PASS' else 'FAIL' end || ' but 4 days late does not');

  -- Cancelled by PayFast, found by token
  perform public.billing_apply_payment(null, 'tok-2', 'pf-10', 19900);
  r := r || (case when public.billing_set_cancelling(null, 'tok-2') and not public.billing_set_cancelling(null, 'tok-unknown') then 'PASS' else 'FAIL' end || ' PayFast cancelling by token works, and an unknown token does nothing');

  -- Storage: Free 200 MB
  insert into storage.objects (bucket_id, name, metadata) values ('documents', ws::text || '/big.bin', jsonb_build_object('size', 150 * 1024 * 1024));
  insert into storage.objects (bucket_id, name, metadata) values ('receipts', ws2::text || '/other.bin', jsonb_build_object('size', 190 * 1024 * 1024));
  update public.workspaces set plan = 'free' where id = ws;
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || (case when public.storage_room(ws, 40 * 1024 * 1024) then 'PASS' else 'FAIL' end || ' Free has room for 40 MB on top of 150 MB');
  r := r || (case when not public.storage_room(ws, 60 * 1024 * 1024) then 'PASS' else 'FAIL' end || ' but not 60 MB, and another business''s files do not count');
  res := public.workspace_usage(ws);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when (res ->> 'storage_used')::bigint = 150 * 1024 * 1024 and res ->> 'plan' = 'free' then 'PASS' else 'FAIL' end || ' the plan page numbers are right (' || res::text || ')');
  update public.workspaces set plan = 'pro' where id = ws;
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || (case when public.storage_room(ws, 60 * 1024 * 1024) then 'PASS' else 'FAIL' end || ' Pro has 10 GB');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select public.storage_room('%s', 1)$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' someone from another business cannot ask about this one');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'BILLING TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
