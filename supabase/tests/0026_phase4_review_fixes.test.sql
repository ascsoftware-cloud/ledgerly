-- Tests for 0026_phase4_review_fixes. Ends by raising "PHASE4 FIX TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb; p uuid; c uuid; t1 uuid; old_timer uuid; new_timer uuid;
  imp uuid; imp2 uuid; l_in uuid; l_out uuid; inv uuid; cat uuid; exp_id uuid; pay uuid;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid();
  ws uuid;
  line jsonb := '[{"description":"Work","quantity":1,"unit_cents":230000,"vat_rate":0}]';
  lines jsonb := '[
    {"posted_on":"2026-11-01","amount_cents":-45000,"description":"POS ENGEN","key":"k1"},
    {"posted_on":"2026-11-03","amount_cents":230000,"description":"EFT THANDI","key":"k2"}
  ]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@p4fix.test'), (sam, 'sam@p4fix.test');
  insert into public.workspaces (slug, name, created_by) values ('p4fix-test', 'A', alice) returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff');
  insert into public.workspace_settings (workspace_id) values (ws);
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;
  insert into public.projects (workspace_id, name, contact_id, hourly_rate_cents) values (ws, 'Kitchen', c, 45000) returning id into p;
  select id into cat from public.expense_categories where workspace_id = ws and name = 'Fuel and travel';

  -- 3. a timer forgotten over the weekend does not block the next one
  insert into public.time_entries (workspace_id, project_id, user_id, started_at)
  values (ws, p, sam, now() - interval '3 days') returning id into old_timer;
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  new_timer := public.start_timer(ws, p, null, 'Monday');
  reset role;
  select extract(epoch from ended_at - started_at)::int::text into t from public.time_entries where id = old_timer;
  r := r || (case when t = '86400' then 'PASS' else 'FAIL' end || ' the forgotten timer is capped at 24 hours (' || coalesce(t, 'still running') || ')');
  r := r || (case when new_timer is not null then 'PASS' else 'FAIL' end || ' and the new timer starts');

  -- 4. a task of someone who left can still be ticked off, and is unassigned
  insert into public.tasks (workspace_id, project_id, title, assignee_id) values (ws, p, 'Measure', sam) returning id into t1;
  delete from public.memberships where workspace_id = ws and user_id = sam;
  select coalesce(assignee_id::text, 'nobody') into t from public.tasks where id = t1;
  r := r || (case when t = 'nobody' then 'PASS' else 'FAIL' end || ' tasks of someone who left become unassigned (' || t || ')');
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.tasks set status = 'done' where id = t1;
  select status into t from public.tasks where id = t1;
  r := r || (case when t = 'done' then 'PASS' else 'FAIL' end || ' and can still be ticked off');
  begin
    update public.tasks set assignee_id = sam where id = t1;
    r := r || 'FAIL a task still cannot be given to someone who left'::text;
  exception when check_violation then r := r || 'PASS a task still cannot be given to someone who left'::text;
  end;

  -- 5. bank decisions can be undone once their payment or expense is gone
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  perform public.send_document(inv);
  res := public.import_bank_lines(ws, 'nov.csv', lines);
  imp := (res ->> 'import_id')::uuid;
  select id into l_out from public.bank_lines where import_id = imp and amount_cents < 0;
  select id into l_in from public.bank_lines where import_id = imp and amount_cents > 0;
  perform public.match_bank_line(l_in, inv);
  exp_id := public.bank_line_to_expense(l_out, cat);
  begin
    perform public.reset_bank_line(l_in);
    r := r || 'FAIL a match cannot be undone while its payment exists'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a match cannot be undone while its payment exists'::text;
  end;
  begin
    perform public.delete_bank_import(imp);
    r := r || 'FAIL an import with matched lines cannot be deleted'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS an import with matched lines cannot be deleted'::text;
  end;
  select id into pay from public.payments where document_id = inv;
  perform public.remove_payment(pay);
  perform public.reset_bank_line(l_in);
  select status || '/' || coalesce(document_id::text, 'none') into t from public.bank_lines where id = l_in;
  r := r || (case when t = 'new/none' then 'PASS' else 'FAIL' end || ' after removing the payment the line is back to sort out (' || t || ')');
  perform public.match_bank_line(l_in, inv);
  select status into t from public.sales_documents where id = inv;
  r := r || (case when t = 'paid' then 'PASS' else 'FAIL' end || ' and can be matched again (' || t || ')');
  update public.expenses set deleted_at = now() where id = exp_id;
  perform public.reset_bank_line(l_out);
  exp_id := public.bank_line_to_expense(l_out, cat);
  r := r || (case when exp_id is not null then 'PASS' else 'FAIL' end || ' an archived expense frees its line to be logged again');

  res := public.import_bank_lines(ws, 'wrong-columns.csv', '[{"posted_on":"2026-11-05","amount_cents":99,"description":"x","key":"k9"}]');
  imp2 := (res ->> 'import_id')::uuid;
  perform public.delete_bank_import(imp2);
  select count(*) into n from public.bank_lines where import_id = imp2;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' an import nobody has used yet can be deleted');
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'PHASE4 FIX TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
