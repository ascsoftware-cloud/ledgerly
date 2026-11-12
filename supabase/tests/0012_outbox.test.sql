-- Tests for 0012_outbox. Ends by raising "OUTBOX TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; o public.outbox;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws uuid; ws_b uuid; c uuid; inv uuid; draft uuid; req uuid := gen_random_uuid(); q1 uuid; q2 uuid;
  line jsonb := '[{"description":"Work","quantity":1,"unit_cents":10000,"vat_rate":0}]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'Alice@Outbox.test'), (sam, 'sam@outbox.test'), (acc, 'acc@outbox.test'), (bob, 'bob@outbox.test');
  insert into public.workspaces (slug, name, created_by) values ('outbox-test-a', 'A', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('outbox-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws_b, bob, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws_b);
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;

  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  draft := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  perform public.send_document(inv);

  q1 := public.queue_document_email(inv, ' Thandi@Client.test ', 'Thanks!', req);
  q2 := public.queue_document_email(inv, 'thandi@client.test', 'Thanks!', req);
  r := r || (case when q1 is not null and q1 = q2 then 'PASS' else 'FAIL' end || ' pressing send twice queues one email');
  perform public.queue_document_email(inv, 'thandi@client.test', null, gen_random_uuid());
  begin
    perform public.queue_document_email(draft, 'thandi@client.test', null, gen_random_uuid());
    r := r || 'FAIL drafts cannot be emailed'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS drafts cannot be emailed'::text;
  end;
  begin
    perform public.queue_document_email(inv, 'not-an-email', null, gen_random_uuid());
    r := r || 'FAIL a bad address is refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a bad address is refused'::text;
  end;
  begin
    insert into public.outbox (workspace_id, template, to_address, idempotency_key) values (ws, 'document', 'x@y.test', 'direct-insert-1');
    r := r || 'FAIL the outbox cannot be written directly'::text;
  exception when insufficient_privilege then r := r || 'PASS the outbox cannot be written directly'::text;
  end;
  begin
    perform public.claim_outbox(10);
    r := r || 'FAIL users cannot run the worker functions'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot run the worker functions'::text;
  end;

  reset role;
  select * into o from public.outbox where id = q1;
  r := r || (case when o.to_address = 'thandi@client.test' and o.reply_to = 'sam@outbox.test' and o.payload ->> 'message' = 'Thanks!'
                  and o.created_by = sam then 'PASS' else 'FAIL' end || ' the email is addressed, and replies go to the sender');

  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.queue_document_email(inv, 'thandi@client.test', null, gen_random_uuid());
    r := r || 'FAIL accountants cannot send emails'::text;
  exception when no_data_found then r := r || 'PASS accountants cannot send emails'::text;
  end;
  select count(*) into n from public.outbox;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' accountants cannot read the outbox');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.queue_document_email(inv, 'evil@x.test', null, gen_random_uuid());
    r := r || 'FAIL another workspace cannot email A''s invoice'::text;
  exception when no_data_found then r := r || 'PASS another workspace cannot email A''s invoice'::text;
  end;
  select count(*) into n from public.outbox;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot read A''s outbox');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.outbox where workspace_id = ws;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' the owner can see what was sent (' || n || ')');
  reset role;

  -- ------------------------------------------------------------ the worker
  set local role service_role;
  select count(*) into n from public.claim_outbox(10);
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' the worker claims what is due (' || n || ')');
  select count(*) into n from public.claim_outbox(10);
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a second worker gets nothing already claimed');

  perform public.finish_outbox(q1, true, 'resend-123', null);
  select status || '/' || provider_id into t from public.outbox where id = q1;
  r := r || (case when t = 'sent/resend-123' then 'PASS' else 'FAIL' end || ' success is recorded with the provider id');
  perform public.finish_outbox(q1, false, null, 'late duplicate result');
  select status into t from public.outbox where id = q1;
  r := r || (case when t = 'sent' then 'PASS' else 'FAIL' end || ' a late second result cannot undo a send');

  select id into q2 from public.outbox where id <> q1 and workspace_id = ws;
  perform public.finish_outbox(q2, false, null, 'Resend 503');
  select status || '/' || attempts into t from public.outbox where id = q2;
  r := r || (case when t = 'pending/1' then 'PASS' else 'FAIL' end || ' a failure goes back in the queue (' || t || ')');
  select count(*) into n from public.outbox where id = q2 and next_attempt_at > now() + interval '1 minute';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and waits before the next try');
  reset role;
  update public.outbox set attempts = 5, status = 'sending' where id = q2;
  set local role service_role;
  perform public.finish_outbox(q2, false, null, 'Resend 503 again');
  select status into t from public.outbox where id = q2;
  r := r || (case when t = 'failed' then 'PASS' else 'FAIL' end || ' it gives up after 5 tries');
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'OUTBOX TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
