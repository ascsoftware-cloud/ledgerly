-- Tests for 0019_review_fixes. Ends by raising "REVIEW FIX TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb; old_id uuid;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid();
  ws uuid; c uuid; inv uuid; inv2 uuid; inv3 uuid; cn uuid; cn_staff uuid; pay uuid; pay_yoco uuid;
  y_old uuid; y_new uuid; y_bad uuid; tok text;
  line jsonb := '[{"description":"Work","quantity":1,"unit_cents":100000,"vat_rate":0}]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@fix.test'), (sam, 'sam@fix.test');
  insert into public.workspaces (slug, name, created_by, plan) values ('fix-test-a', 'A', alice, 'pro') returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff');
  insert into public.workspace_settings (workspace_id) values (ws);
  insert into public.contacts (workspace_id, name, email) values (ws, 'Thandi', 'thandi@client.test') returning id into c;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  inv2 := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  inv3 := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  perform public.send_document(inv); perform public.send_document(inv2); perform public.send_document(inv3);

  -- ------------------------------------------------------------ 1. voiding a credit note restores the invoice
  cn := public.create_credit_note(inv);
  perform public.send_document(cn);
  select status || '/' || credited_cents into t from public.sales_documents where id = inv;
  r := r || (case when t = 'paid/100000' then 'PASS' else 'FAIL' end || ' a full credit note settles the invoice (' || t || ')');
  perform public.void_document(cn);
  select status || '/' || credited_cents into t from public.sales_documents where id = inv;
  r := r || (case when t = 'sent/0' then 'PASS' else 'FAIL' end || ' voiding the credit note puts the invoice back to owing (' || t || ')');
  perform public.void_document(cn);
  select credited_cents::text into t from public.sales_documents where id = inv;
  r := r || (case when t = '0' then 'PASS' else 'FAIL' end || ' voiding it twice does not credit back twice (' || t || ')');

  -- ------------------------------------------------------------ 3. manual payments: capped and removable
  begin
    perform public.record_manual_payment(inv2, 1500000, 'eft', null, null, null, gen_random_uuid());
    r := r || 'FAIL a payment above what is owed is refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a payment above what is owed is refused'::text;
  end;
  res := public.record_manual_payment(inv2, 40000, 'eft', null, 'typo', null, gen_random_uuid());
  pay := (res ->> 'payment_id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.remove_payment(pay);
    r := r || 'FAIL staff cannot remove a payment'::text;
  exception when no_data_found then r := r || 'PASS staff cannot remove a payment'::text;
  end;

  -- ------------------------------------------------------------ 2. staff cannot issue credit notes
  begin
    insert into public.sales_documents (workspace_id, kind, contact_id, source_id) values (ws, 'credit_note', c, inv3);
    r := r || 'FAIL staff cannot create a credit note directly'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot create a credit note directly'::text;
  end;
  reset role;
  insert into public.sales_documents (workspace_id, kind, contact_id, source_id) values (ws, 'credit_note', c, inv3) returning id into cn_staff;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate)
  values (ws, cn_staff, 1, 'Write-off', 1, 100000, 0);
  set local role authenticated;
  begin
    perform public.send_document(cn_staff);
    r := r || 'FAIL staff cannot send a credit note'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot send a credit note'::text;
  end;
  select status into t from public.sales_documents where id = inv3;
  r := r || (case when t = 'sent' then 'PASS' else 'FAIL' end || ' the invoice is untouched (' || t || ')');

  -- back to the owner
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.remove_payment(pay);
  select status || '/' || paid_cents into t from public.sales_documents where id = inv2;
  r := r || (case when t = 'sent/0' then 'PASS' else 'FAIL' end || ' the owner can remove a mistaken payment (' || t || ')');
  select count(*) into n from public.payments where id = pay;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' the payment is gone');
  select count(*) into n from public.activities where workspace_id = ws and kind = 'payment_removed';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' removing it shows on the timeline');
  reset role;
  insert into public.payments (workspace_id, document_id, method, amount_cents, provider_ref)
  values (ws, inv2, 'yoco', 100, 'p_card') returning id into pay_yoco;
  set local role authenticated;
  begin
    perform public.remove_payment(pay_yoco);
    r := r || 'FAIL card payments from Yoco or PayFast cannot be removed by hand'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS card payments from Yoco or PayFast cannot be removed by hand'::text;
  end;

  -- ------------------------------------------------------------ 4. reconnecting Yoco never drops the working connection
  y_old := public.connect_payment_provider(ws, 'yoco', 'test', null, 'sk_test_abcdefghijklmnop', null);
  perform public.attach_yoco_webhook(y_old, 'wh_old', 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');
  y_bad := public.connect_payment_provider(ws, 'yoco', 'test', null, 'sk_test_mistypedkey12345', null);
  select status into t from public.payment_connections where id = y_old;
  r := r || (case when t = 'active' then 'PASS' else 'FAIL' end || ' a new key does not switch off the working one (' || t || ')');
  perform public.disconnect_payment_provider(y_bad);
  select status into t from public.payment_connections where id = y_old;
  r := r || (case when t = 'active' then 'PASS' else 'FAIL' end || ' a failed reconnect leaves card payments on (' || t || ')');
  y_new := public.connect_payment_provider(ws, 'yoco', 'test', null, 'sk_test_qrstuvwxyz012345', null);
  old_id := public.attach_yoco_webhook(y_new, 'wh_new', 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');
  select string_agg(status, ',' order by (id = y_new)) into t from public.payment_connections where id in (y_old, y_new);
  r := r || (case when t = 'disabled,active' and old_id = y_old then 'PASS' else 'FAIL' end || ' a working new key takes over and names the old one (' || coalesce(t, 'none') || ')');
  begin
    perform public.purge_connection_secrets(y_old);
    r := r || 'FAIL users cannot purge connection secrets'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot purge connection secrets'::text;
  end;
  reset role;
  set local role service_role;
  perform public.purge_connection_secrets(y_new);
  perform public.purge_connection_secrets(y_old);
  reset role;
  select count(*) into n from public.payment_connections where id = y_new and secret_id is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the active connection keeps its keys');
  select count(*) into n from vault.secrets s join public.payment_connections p on s.id in (p.secret_id, p.webhook_secret_id) where p.id = y_old;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' the replaced connection''s keys are deleted');

  -- ------------------------------------------------------------ 7. emailing is throttled
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..5 loop
    perform public.queue_document_email(inv3, 'thandi@client.test', null, gen_random_uuid());
  end loop;
  begin
    perform public.queue_document_email(inv3, 'thandi@client.test', null, gen_random_uuid());
    r := r || 'FAIL a sixth email of one document in a day is refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a sixth email of one document in a day is refused'::text;
  end;
  perform public.queue_document_email(inv2, 'thandi@client.test', null, gen_random_uuid());
  r := r || 'PASS other documents can still be emailed'::text;

  -- ------------------------------------------------------------ 8. the business opening its own link is not "viewed"
  select public_token into tok from public.sales_documents where id = inv2;
  perform public.mark_document_viewed(tok);
  select coalesce(viewed_at::text, 'none') into t from public.sales_documents where id = inv2;
  r := r || (case when t = 'none' then 'PASS' else 'FAIL' end || ' a member opening the link does not mark it viewed');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  perform public.mark_document_viewed(tok);
  reset role;
  select status into t from public.sales_documents where id = inv2;
  r := r || (case when t = 'viewed' then 'PASS' else 'FAIL' end || ' the client opening it does (' || t || ')');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'REVIEW FIX TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
