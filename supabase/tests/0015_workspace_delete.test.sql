-- Tests for 0015. Ends by raising "DELETE TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int;
  alice uuid := gen_random_uuid();
  ws uuid; c uuid; inv uuid; stage uuid;
  line jsonb := '[{"description":"Work","quantity":1,"unit_cents":10000,"vat_rate":0}]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@delete.test');
  insert into public.workspaces (slug, name, created_by) values ('delete-test-a', 'A', alice) returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws);

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;
  select id into stage from public.pipeline_stages where workspace_id = ws and position = 1;
  insert into public.deals (workspace_id, stage_id, contact_id, title) values (ws, stage, c, 'Deal');
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  perform public.send_document(inv);
  perform public.record_manual_payment(inv, 10000, 'eft', null, null, null, gen_random_uuid());
  reset role;

  begin
    delete from public.contacts where id = c;
    r := r || 'FAIL a client with invoices cannot be deleted on their own'::text;
  exception when foreign_key_violation then r := r || 'PASS a client with invoices cannot be deleted on their own'::text;
  end;
  begin
    delete from public.sales_documents where id = inv;
    r := r || 'FAIL an invoice with payments cannot be deleted on its own'::text;
  exception when foreign_key_violation then r := r || 'PASS an invoice with payments cannot be deleted on its own'::text;
  end;
  begin
    delete from public.pipeline_stages where id = stage;
    r := r || 'FAIL a stage with deals cannot be deleted on its own'::text;
  exception when foreign_key_violation then r := r || 'PASS a stage with deals cannot be deleted on its own'::text;
  end;

  begin
    delete from public.workspaces where id = ws;
    r := r || 'PASS a whole workspace with clients, deals, invoices and payments can be deleted'::text;
  exception when others then
    r := r || ('FAIL a whole workspace can be deleted (' || sqlerrm || ')');
  end;
  select (select count(*) from public.contacts where workspace_id = ws) + (select count(*) from public.sales_documents where workspace_id = ws)
       + (select count(*) from public.payments where workspace_id = ws) + (select count(*) from public.deals where workspace_id = ws)
       + (select count(*) from public.activities where workspace_id = ws) + (select count(*) from public.xp_events where workspace_id = ws)
    into n;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' nothing of it is left behind (' || n || ' rows)');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'DELETE TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
