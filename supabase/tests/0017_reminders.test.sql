-- Tests for 0017_reminders. Ends by raising "REMINDER TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text;
  alice uuid := gen_random_uuid();
  ws uuid; c uuid; c_noemail uuid;
  soon uuid; today_inv uuid; late uuid; paid uuid; noemail uuid; far uuid;
  d0 date := (now() at time zone 'Africa/Johannesburg')::date;
  line jsonb := '[{"description":"Work","quantity":1,"unit_cents":10000,"vat_rate":0}]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'Alice@Remind.test');
  insert into public.workspaces (slug, name, created_by, plan) values ('remind-test-a', 'A', alice, 'pro') returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws);
  insert into public.contacts (workspace_id, name, email) values (ws, 'Thandi', 'thandi@client.test') returning id into c;
  insert into public.contacts (workspace_id, name) values (ws, 'No Email') returning id into c_noemail;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  soon := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c, 'due_date', d0 + 3), line);
  today_inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c, 'due_date', d0), line);
  late := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c, 'due_date', d0 + 3), line);
  paid := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c, 'due_date', d0), line);
  noemail := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_noemail, 'due_date', d0), line);
  far := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c, 'due_date', d0 + 10), line);
  perform public.send_document(soon); perform public.send_document(today_inv); perform public.send_document(late);
  perform public.send_document(paid); perform public.send_document(noemail); perform public.send_document(far);
  perform public.record_manual_payment(paid, 10000, 'eft', null, null, null, gen_random_uuid());
  reset role;
  update public.sales_documents set due_date = d0 - 3 where id = late;

  set local role service_role;
  n := public.queue_due_reminders();
  reset role;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' nothing is sent while reminders are switched off (' || n || ')');

  update public.workspace_settings set auto_reminders = true where workspace_id = ws;
  set local role service_role;
  n := public.queue_due_reminders();
  r := r || (case when n = 3 then 'PASS' else 'FAIL' end || ' three reminders: 3 days before, on the day, 3 days after (' || n || ')');
  n := public.queue_due_reminders();
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' running again the same day sends nothing new');
  reset role;

  select string_agg(split_part(idempotency_key, ':', 3), ',' order by split_part(idempotency_key, ':', 3)) into t
  from public.outbox where workspace_id = ws and template = 'reminder';
  r := r || (case when t = 'after,before,due' then 'PASS' else 'FAIL' end || ' one per stage (' || coalesce(t, 'none') || ')');
  select count(*) into n from public.outbox where payload ->> 'document_id' in (paid::text, noemail::text, far::text);
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' paid invoices, clients without email and later due dates are skipped');
  select count(*) into n from public.outbox where workspace_id = ws and reply_to = 'alice@remind.test' and to_address = 'thandi@client.test';
  r := r || (case when n = 3 then 'PASS' else 'FAIL' end || ' replies go to the business owner');
  select payload ->> 'message' into t from public.outbox where idempotency_key = 'reminder:' || late || ':after';
  r := r || (case when t like 'Invoice INV-% was due on %. If you have already paid, thank you, and please ignore this.' then 'PASS' else 'FAIL' end
             || ' the overdue wording is polite (' || coalesce(t, 'none') || ')');

  set local role authenticated;
  begin
    perform public.queue_due_reminders();
    r := r || 'FAIL users cannot trigger the reminder run'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot trigger the reminder run'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'REMINDER TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
