-- Tests for 0014_payments. Ends by raising "PAYMENTS TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb; sec record;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws uuid; ws_b uuid; c uuid; c_b uuid; inv uuid; inv2 uuid; quo uuid; draft uuid; inv_b uuid;
  req uuid := gen_random_uuid(); yoco1 uuid; yoco2 uuid; pf uuid; conn_b uuid; co uuid; co_b uuid; old_secret uuid;
  line jsonb := '[{"description":"Work","quantity":1,"unit_cents":100000,"vat_rate":0}]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@pay.test'), (sam, 'sam@pay.test'), (acc, 'acc@pay.test'), (bob, 'bob@pay.test');
  insert into public.workspaces (slug, name, created_by) values ('pay-test-a', 'A', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('pay-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws_b, bob, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws_b);
  insert into public.quest_steps (workspace_id, key, position) values (ws, 'get_paid_setup', 1);
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;
  insert into public.contacts (workspace_id, name) values (ws_b, 'Bea') returning id into c_b;

  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  inv2 := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  quo := public.save_document_draft(ws, null, jsonb_build_object('kind', 'quote', 'contact_id', c), line);
  draft := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  perform public.send_document(inv);
  perform public.send_document(inv2);
  perform public.send_document(quo);

  -- ------------------------------------------------------------ EFT and cash
  res := public.record_manual_payment(inv, 40000, 'eft', null, 'FNB ref 123', null, req);
  select status || '/' || paid_cents into t from public.sales_documents where id = inv;
  r := r || (case when t = 'part_paid/40000' and (res ->> 'first')::boolean then 'PASS' else 'FAIL' end || ' a part payment is recorded (' || t || ')');
  res := public.record_manual_payment(inv, 40000, 'eft', null, 'FNB ref 123', null, req);
  select paid_cents::text into t from public.sales_documents where id = inv;
  r := r || (case when (res ->> 'duplicate')::boolean and t = '40000' then 'PASS' else 'FAIL' end || ' pressing save twice records it once');
  res := public.record_manual_payment(inv, 60000, 'cash', null, null, null, gen_random_uuid());
  select status || '/' || paid_cents into t from public.sales_documents where id = inv;
  r := r || (case when t = 'paid/100000' and not (res ->> 'first')::boolean then 'PASS' else 'FAIL' end || ' the rest settles it (' || t || ')');
  select count(*) into n from public.activities where workspace_id = ws and kind = 'payment_received';
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' each payment shows on the timeline');
  select count(*) into n from public.xp_events where workspace_id = ws and kind = 'payment_received' and points = 50;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' each payment earns 50 XP');

  begin
    perform public.record_manual_payment(inv2, 100, 'eft', (now() at time zone 'Africa/Johannesburg')::date + 3, null, null, gen_random_uuid());
    r := r || 'FAIL a future payment date is refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a future payment date is refused'::text;
  end;
  begin
    perform public.record_manual_payment(draft, 100, 'eft', null, null, null, gen_random_uuid());
    r := r || 'FAIL a draft cannot be paid'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a draft cannot be paid'::text;
  end;
  begin
    perform public.record_manual_payment(quo, 100, 'eft', null, null, null, gen_random_uuid());
    r := r || 'FAIL a quote cannot be paid'::text;
  exception when no_data_found then r := r || 'PASS a quote cannot be paid'::text;
  end;
  begin
    perform public.record_manual_payment(inv2, 100, 'yoco', null, null, null, gen_random_uuid());
    r := r || 'FAIL card payments through Yoco cannot be typed in by hand'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS card payments through Yoco cannot be typed in by hand'::text;
  end;
  begin
    perform public.record_manual_payment(inv2, 100, 'eft', null, null, ws_b || '/proof.pdf', gen_random_uuid());
    r := r || 'FAIL a proof file from another workspace is refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a proof file from another workspace is refused'::text;
  end;
  begin
    perform public.connect_payment_provider(ws, 'yoco', 'test', null, 'sk_test_abcdefghijklmnop', null);
    r := r || 'FAIL staff cannot connect payment accounts'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot connect payment accounts'::text;
  end;
  reset role;

  -- ------------------------------------------------------------ connecting (owner)
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.connect_payment_provider(ws, 'yoco', 'test', null, 'pk_test_wrongkind', null);
    r := r || 'FAIL a public key is refused as a secret key'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a public key is refused as a secret key'::text;
  end;
  begin
    perform public.connect_payment_provider(ws, 'yoco', 'live', null, 'sk_test_abcdefghijklmnop', null);
    r := r || 'FAIL a test key cannot be used in live mode'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a test key cannot be used in live mode'::text;
  end;
  yoco1 := public.connect_payment_provider(ws, 'yoco', 'test', null, 'sk_test_abcdefghijklmnop', null);
  yoco2 := public.connect_payment_provider(ws, 'yoco', 'test', null, 'sk_test_qrstuvwxyz012345', null);
  pf := public.connect_payment_provider(ws, 'payfast', 'test', '10000100', '46f0cd694581a', 'jt7NOE43FZPn');
  select count(*) into n from public.payment_connections where workspace_id = ws and provider = 'yoco' and status = 'pending';
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' a Yoco key waits as pending until its webhook is attached');
  select count(*) into n from public.quest_steps where workspace_id = ws and key = 'get_paid_setup' and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' connecting ticks "Set up how you get paid"');
  begin
    perform secret_id from public.payment_connections where id = yoco2;
    r := r || 'FAIL secret references are not readable from the app'::text;
  exception when insufficient_privilege then r := r || 'PASS secret references are not readable from the app'::text;
  end;
  begin
    perform * from public.payment_connection_secrets(yoco2);
    r := r || 'FAIL users cannot read decrypted secrets'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot read decrypted secrets'::text;
  end;
  begin
    perform public.apply_payment_event(yoco2, 'yoco', 'evt_fake', gen_random_uuid(), 100000, 'p_fake', '{}');
    r := r || 'FAIL users cannot fake a payment notification'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot fake a payment notification'::text;
  end;
  begin
    perform public.attach_yoco_webhook(yoco2, 'wh_1', 'not-a-secret');
    r := r || 'FAIL a malformed webhook secret is refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a malformed webhook secret is refused'::text;
  end;
  perform public.attach_yoco_webhook(yoco2, 'wh_1', 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');
  select count(*) into n from public.payment_connections where workspace_id = ws and provider = 'yoco' and status = 'active';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' attaching the webhook makes it the one active connection');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.payments where workspace_id = ws;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' accountants can see payments');
  select count(*) into n from public.payment_connections;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' accountants cannot see payment connections');
  begin
    perform public.record_manual_payment(inv2, 100, 'eft', null, null, null, gen_random_uuid());
    r := r || 'FAIL accountants cannot record payments'::text;
  exception when no_data_found then r := r || 'PASS accountants cannot record payments'::text;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.payments where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s payments');
  begin
    perform public.record_manual_payment(inv2, 100, 'eft', null, null, null, gen_random_uuid());
    r := r || 'FAIL another workspace cannot record a payment on A''s invoice'::text;
  exception when no_data_found then r := r || 'PASS another workspace cannot record a payment on A''s invoice'::text;
  end;
  begin
    perform public.disconnect_payment_provider(yoco2);
    r := r || 'FAIL another workspace cannot disconnect A''s Yoco'::text;
  exception when no_data_found then r := r || 'PASS another workspace cannot disconnect A''s Yoco'::text;
  end;
  inv_b := public.save_document_draft(ws_b, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_b), line);
  perform public.send_document(inv_b);
  conn_b := public.connect_payment_provider(ws_b, 'yoco', 'test', null, 'sk_test_bbbbbbbbbbbbbbbb', null);
  reset role;

  -- ------------------------------------------------------------ provider notifications (server)
  set local role service_role;
  select * into sec from public.payment_connection_secrets(yoco2);
  r := r || (case when sec.secret = 'sk_test_qrstuvwxyz012345' and sec.webhook_secret like 'whsec_%' and sec.workspace_id = ws then 'PASS' else 'FAIL' end
             || ' the server can read the secrets it needs');
  select * into sec from public.payment_connection_secrets(pf);
  r := r || (case when sec.merchant_id = '10000100' and sec.secret = '46f0cd694581a' and sec.passphrase = 'jt7NOE43FZPn' then 'PASS' else 'FAIL' end
             || ' PayFast merchant key and passphrase are kept');
  reset role;

  insert into public.payment_checkouts (workspace_id, document_id, connection_id, provider, amount_cents)
  values (ws, inv2, yoco2, 'yoco', 100000) returning id into co;
  insert into public.payment_checkouts (workspace_id, document_id, connection_id, provider, amount_cents)
  values (ws_b, inv_b, conn_b, 'yoco', 100000) returning id into co_b;

  set local role service_role;
  t := public.apply_payment_event(yoco2, 'yoco', 'evt_wrong_amount', co, 100, 'p_wrong', '{}');
  r := r || (case when t like 'rejected: amount%' then 'PASS' else 'FAIL' end || ' a notification for the wrong amount is rejected (' || t || ')');
  t := public.apply_payment_event(yoco2, 'yoco', 'evt_other_ws', co_b, 100000, 'p_other', '{}');
  r := r || (case when t = 'rejected: checkout belongs to another connection' then 'PASS' else 'FAIL' end || ' another workspace''s checkout is rejected');
  t := public.apply_payment_event(yoco2, 'yoco', 'evt_unknown', gen_random_uuid(), 100000, 'p_unknown', '{}');
  r := r || (case when t = 'rejected: unknown checkout' then 'PASS' else 'FAIL' end || ' an unknown checkout is rejected');
  t := public.apply_payment_event(yoco2, 'yoco', 'evt_ok', co, 100000, 'p_ok', '{"type":"payment.succeeded"}');
  r := r || (case when t = 'applied' then 'PASS' else 'FAIL' end || ' a matching notification is applied (' || t || ')');
  t := public.apply_payment_event(yoco2, 'yoco', 'evt_ok', co, 100000, 'p_ok', '{}');
  r := r || (case when t = 'duplicate' then 'PASS' else 'FAIL' end || ' the same notification again is ignored');
  t := public.apply_payment_event(yoco2, 'yoco', 'evt_retry_new_id', co, 100000, 'p_ok', '{}');
  r := r || (case when t = 'duplicate payment' then 'PASS' else 'FAIL' end || ' a resend with a new event id still pays once');
  reset role;
  select status || '/' || paid_cents into t from public.sales_documents where id = inv2;
  r := r || (case when t = 'paid/100000' then 'PASS' else 'FAIL' end || ' the invoice is paid exactly once (' || t || ')');
  select count(*) into n from public.payment_events where connection_id = yoco2;
  r := r || (case when n = 5 then 'PASS' else 'FAIL' end || ' every notification is logged, accepted or not (' || n || ')');

  -- ------------------------------------------------------------ disconnecting
  select secret_id into old_secret from public.payment_connections where id = yoco2;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.disconnect_payment_provider(yoco2);
  reset role;
  select count(*) into n from vault.secrets where id = old_secret;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' disconnecting deletes the stored secrets');

  set local role anon;
  begin
    perform count(*) from public.payments;
    r := r || 'FAIL strangers cannot read payments'::text;
  exception when insufficient_privilege then r := r || 'PASS strangers cannot read payments'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'PAYMENTS TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
