-- Tests for 0040_phase7_review_fixes. Ends by raising "PHASE 7 FIX TESTS: n passed, m failed" (rolls back).
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

create function pg_temp.as_user(uid uuid, q text) returns text language plpgsql as $f$
declare res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute q into res;
  exception when others then
    res := 'ERR:' || sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return res;
end
$f$;

do $$
declare
  r text[] := '{}';
  n int; t text; ck1 uuid; ck2 uuid; ck3 uuid; pe timestamptz;
  olga uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); eve uuid := gen_random_uuid(); pro uuid := gen_random_uuid();
  ws uuid; ws2 uuid; ws_p uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@p7.test'), (sam, 'sam@p7.test'), (eve, 'eve@p7.test'), (pro, 'pro@p7.test');
  insert into public.profiles (id, full_name) values (olga, 'Olga'), (sam, 'Sam'), (eve, 'Eve'), (pro, 'Pro') on conflict (id) do nothing;
  insert into public.workspaces (slug, name, created_by) values ('p7-test-a', 'A', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('p7-test-b', 'B', eve) returning id into ws2;
  insert into public.workspaces (slug, name, created_by, plan) values ('p7-test-p', 'P', pro, 'pro') returning id into ws_p;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner'), (ws, sam, 'staff'), (ws2, eve, 'owner'), (ws_p, pro, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws2), (ws_p);

  -- Checkouts: pressing Upgrade twice is one checkout
  ck1 := public.billing_start_checkout(ws, olga, 19900);
  ck2 := public.billing_start_checkout(ws, olga, 19900);
  r := r || (case when ck1 = ck2 then 'PASS' else 'FAIL' end || ' pressing Upgrade twice reuses the same checkout');
  update public.billing_checkouts set created_at = now() - interval '2 hours' where id = ck1;
  ck3 := public.billing_start_checkout(ws, olga, 19900);
  r := r || (case when ck3 <> ck1 then 'PASS' else 'FAIL' end || ' and an old one is not reused');
  update public.workspaces set deletion_requested_at = now() where id = ws;
  begin
    perform public.billing_start_checkout(ws, olga, 19900);
    r := r || 'FAIL a checkout was started while the business waits to be deleted'::text;
  exception when sqlstate 'LDG03' then
    r := r || 'PASS no upgrade while a deletion is pending'::text;
  end;
  update public.workspaces set deletion_requested_at = null where id = ws;

  -- A second PayFast subscription is recognised, not swapped in
  t := public.billing_apply_payment(ck3, 'tok-A', 'pf-a1', 19900);
  r := r || (case when t = 'activated' then 'PASS' else 'FAIL' end || ' the first payment activates (' || t || ')');
  select current_period_end into pe from public.subscriptions where workspace_id = ws;
  t := public.billing_apply_payment(ck3, 'tok-B', 'pf-b1', 19900);
  r := r || (case when t = 'extra_subscription' then 'PASS' else 'FAIL' end || ' a payment on a different token for the same business is a second subscription (' || t || ')');
  r := r || (case when public.billing_get_token(ws, olga) = 'tok-A' then 'PASS' else 'FAIL' end || ' and the stored token is not replaced');
  r := r || (case when (select current_period_end from public.subscriptions where workspace_id = ws) > pe + interval '27 days' then 'PASS' else 'FAIL' end || ' while the month that was paid for is given');
  t := public.billing_apply_payment(null, 'tok-A', 'pf-a2', 19900);
  r := r || (case when t = 'extended' then 'PASS' else 'FAIL' end || ' the first subscription still renews normally (' || t || ')');

  -- A cancelled subscription is not brought back by a late notice
  perform public.billing_set_cancelling(ws, null);
  t := public.billing_apply_payment(null, 'tok-A', 'pf-a3', 19900);
  r := r || (case when (select status from public.subscriptions where workspace_id = ws) = 'cancelling' then 'PASS' else 'FAIL' end || ' a payment that was already on its way does not undo a cancellation');
  update public.subscriptions set current_period_end = now() - interval '1 hour' where workspace_id = ws;
  perform app.expire_subscriptions();
  t := public.billing_apply_payment(null, 'tok-A', 'pf-a4', 19900);
  r := r || (case when (select status from public.subscriptions where workspace_id = ws) = 'cancelling' then 'PASS' else 'FAIL' end || ' even after the plan has ended (an owner-cancelled subscription never turns active again by itself)');
  -- ... but a new subscription after that works
  update public.subscriptions set status = 'cancelled' where workspace_id = ws;
  update public.workspaces set plan = 'free' where id = ws;
  ck1 := public.billing_start_checkout(ws, olga, 19900);
  t := public.billing_apply_payment(ck1, 'tok-C', 'pf-c1', 19900);
  r := r || (case when (select status from public.subscriptions where workspace_id = ws) = 'active' and public.billing_get_token(ws, olga) = 'tok-C' then 'PASS' else 'FAIL' end || ' a brand new subscription after cancelling starts cleanly (' || t || ')');
  -- A late payer (not cancelled by the owner) comes back when the payment lands
  update public.subscriptions set status = 'cancelled', cancelled_at = null where workspace_id = ws;
  update public.workspaces set plan = 'free' where id = ws;
  t := public.billing_apply_payment(null, 'tok-C', 'pf-c2', 19900);
  r := r || (case when (select status from public.subscriptions where workspace_id = ws) = 'active' and (select plan from public.workspaces where id = ws) = 'pro' then 'PASS' else 'FAIL' end || ' a late payer whose payment finally arrives is Pro again');

  -- Billing records outlive the business
  select count(*) into n from public.billing_events where workspace_id = ws;
  r := r || (case when n >= 3 then 'PASS' else 'FAIL' end || ' billing events were recorded (' || n || ')');

  -- Purge never deletes a business that is still being charged
  update public.workspaces set deletion_requested_at = now() - interval '8 days' where id = ws;
  r := r || (case when (public.purge_due() -> 'workspaces') = '[]'::jsonb and (public.purge_due() -> 'blocked') @> jsonb_build_array(ws) then 'PASS' else 'FAIL' end || ' a business with an active subscription is blocked, not purged');
  update public.subscriptions set status = 'cancelling' where workspace_id = ws;
  r := r || (case when (public.purge_due() -> 'workspaces') @> jsonb_build_array(ws) then 'PASS' else 'FAIL' end || ' once the subscription is cancelled it is due');
  delete from public.workspaces where id = ws;
  select count(*) into n from public.billing_events where workspace_id is null and pf_payment_id like 'pf-%';
  r := r || (case when n >= 3 then 'PASS' else 'FAIL' end || ' and its billing records survive its deletion (' || n || ' kept)');

  -- Account deletion can always finish
  insert into public.workspaces (slug, name, created_by) values ('p7-test-s', 'S', sam) returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, sam, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws);
  insert into public.workspaces (slug, name, created_by, deletion_requested_at, deletion_requested_by) values ('p7-test-sep', 'Sep', sam, now(), sam) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values (ws2, sam, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws2);
  t := pg_temp.as_user(sam, 'select public.request_account_deletion()::text');
  r := r || (case when t not like 'ERR:%' then 'PASS' else 'FAIL' end || ' a sole owner can ask to delete their account (' || t || ')');
  t := pg_temp.as_user(sam, format($q$select public.cancel_workspace_deletion('%s')::text$q$, ws));
  r := r || (case when t = 'ERR:LDG03' then 'PASS' else 'FAIL' end || ' but cannot keep the business that is going with the account (' || t || ')');
  t := pg_temp.as_user(sam, 'select public.create_additional_workspace(''Another'')::text');
  r := r || (case when t like 'ERR:%' then 'PASS' else 'FAIL' end || ' and cannot start another business meanwhile (' || t || ')');
  perform pg_temp.as_user(sam, 'select public.cancel_account_deletion()::text');
  r := r || (case when (select deletion_requested_at from public.workspaces where id = ws) is null and (select deletion_requested_at from public.workspaces where id = ws2) is not null then 'PASS' else 'FAIL' end || ' cancelling the account restores what it flagged, and leaves a business deletion asked for separately');

  -- Consents cannot be backdated
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.consents (user_id, kind, granted, version, created_at) values ('%s', 'push', true, 'v1', now() - interval '3 years')$q$, olga)) = -1 then 'PASS' else 'FAIL' end || ' a consent cannot be given a made-up date');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.consents (user_id, kind, granted, version) values ('%s', 'push', true, 'v1')$q$, olga)) = 1 then 'PASS' else 'FAIL' end || ' but a normal one still records');

  -- The storage cap holds against direct uploads
  insert into storage.objects (bucket_id, name, metadata) values ('documents', ws_p::text || '/big.bin', jsonb_build_object('size', 1024));
  update public.workspaces set plan = 'free' where id = ws_p;
  insert into storage.objects (bucket_id, name, metadata) values ('documents', ws_p::text || '/huge.bin', jsonb_build_object('size', 250 * 1024 * 1024));
  r := r || (case when pg_temp.probe('authenticated', pro, format($q$insert into storage.objects (bucket_id, name) values ('documents', '%s/direct.txt')$q$, ws_p)) = -1 then 'PASS' else 'FAIL' end || ' a business over its limit cannot upload into Docs by calling storage directly');
  r := r || (case when pg_temp.probe('authenticated', pro, format($q$insert into storage.objects (bucket_id, name) values ('receipts', '%s/%s/direct.txt')$q$, ws_p, gen_random_uuid())) = -1 then 'PASS' else 'FAIL' end || ' nor receipts');
  r := r || (case when pg_temp.probe('authenticated', pro, format($q$insert into storage.objects (bucket_id, name) values ('payment-proofs', '%s/%s/direct.txt')$q$, ws_p, gen_random_uuid())) = -1 then 'PASS' else 'FAIL' end || ' nor proofs of payment');
  update public.workspaces set plan = 'pro' where id = ws_p;
  r := r || (case when pg_temp.probe('authenticated', pro, format($q$insert into storage.objects (bucket_id, name) values ('documents', '%s/ok.txt')$q$, ws_p)) = 1 then 'PASS' else 'FAIL' end || ' but with room (Pro) it still works');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into storage.objects (bucket_id, name) values ('documents', '%s/sneaky.txt')$q$, ws_p)) = -1 then 'PASS' else 'FAIL' end || ' and someone from another business still cannot');
  r := r || (case when (select public from storage.buckets where id = 'exports') = false then 'PASS' else 'FAIL' end || ' the exports bucket exists and is private');
  r := r || (case when pg_temp.probe('authenticated', pro, $q$select 1 from storage.objects where bucket_id = 'exports'$q$) = 0 then 'PASS' else 'FAIL' end || ' and nobody signed in can list it');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'PHASE 7 FIX TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
