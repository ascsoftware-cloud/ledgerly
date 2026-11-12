-- Tests for 0023_time. Ends by raising "TIME TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; p uuid; p_norate uuid; p_noclient uuid; c uuid; run1 uuid; run2 uuid; e1 uuid; e2 uuid; e3 uuid; e_bob uuid; inv uuid; inv2 uuid;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws uuid; ws_b uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@time.test'), (sam, 'sam@time.test'), (acc, 'acc@time.test'), (bob, 'bob@time.test');
  insert into public.workspaces (slug, name, created_by) values ('time-test-a', 'A', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('time-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws_b, bob, 'owner');
  insert into public.workspace_settings (workspace_id, vat_registered) values (ws, true);
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;
  insert into public.projects (workspace_id, name, contact_id, hourly_rate_cents) values (ws, 'Kitchen', c, 45000) returning id into p;
  insert into public.projects (workspace_id, name, contact_id) values (ws, 'Favour', c) returning id into p_norate;
  insert into public.projects (workspace_id, name, hourly_rate_cents) values (ws, 'Own shop', 30000) returning id into p_noclient;

  -- timers: one running per person; starting another stops the first
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  run1 := public.start_timer(ws, p, null, 'Tiling');
  run2 := public.start_timer(ws, p, null, 'Grouting');
  select count(*) into n from public.time_entries where workspace_id = ws and user_id = sam and ended_at is null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' only one timer runs per person (' || n || ')');
  select count(*) into n from public.time_entries where id = run1 and ended_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' starting a new timer stops the old one');
  perform public.stop_timer(ws);
  select count(*) into n from public.time_entries where workspace_id = ws and ended_at is null;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' stopping the timer ends it');

  -- manual entries
  insert into public.time_entries (workspace_id, project_id, started_at, ended_at, description)
  values (ws, p, '2026-11-10 07:00+00', '2026-11-10 08:30+00', 'Measure and plan') returning id into e1;
  insert into public.time_entries (workspace_id, project_id, started_at, ended_at, description)
  values (ws, p, '2026-11-11 07:00+00', '2026-11-11 07:20+00', 'Call supplier') returning id into e2;
  insert into public.time_entries (workspace_id, project_id, started_at, ended_at, description, billable)
  values (ws, p, '2026-11-11 09:00+00', '2026-11-11 10:00+00', 'Travel', false) returning id into e3;
  select user_id::text into t from public.time_entries where id = e1;
  r := r || (case when t = sam::text then 'PASS' else 'FAIL' end || ' manual time is logged as the person who entered it');
  begin
    insert into public.time_entries (workspace_id, project_id, started_at, ended_at) values (ws, p, '2026-11-11 10:00+00', '2026-11-11 09:00+00');
    r := r || 'FAIL time cannot end before it starts'::text;
  exception when check_violation then r := r || 'PASS time cannot end before it starts'::text;
  end;
  begin
    insert into public.time_entries (workspace_id, project_id, user_id, started_at, ended_at) values (ws, p, alice, '2026-11-11 07:00+00', '2026-11-11 08:00+00');
    r := r || 'FAIL staff cannot log time as someone else'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot log time as someone else'::text;
  end;

  -- billable hours → one draft invoice, each entry once
  inv := public.invoice_time_entries(p, array[e1, e2]);
  select count(*) || '/' || trim_scale(sum(quantity)) || '/' || min(unit_cents) || '/' || min(vat_rate) into t from public.sales_document_lines where document_id = inv;
  r := r || (case when t = '2/1.83/45000/15' then 'PASS' else 'FAIL' end || ' a draft invoice gets one line per entry, hours × rate, with VAT (' || coalesce(t, 'none') || ')');
  select kind || '/' || status || '/' || contact_id into t from public.sales_documents where id = inv;
  r := r || (case when t = 'invoice/draft/' || c then 'PASS' else 'FAIL' end || ' it is a draft for the project''s client');
  select total_cents::text into t from public.sales_documents where id = inv;
  r := r || (case when t = '94703' then 'PASS' else 'FAIL' end || ' total = 1,50 h + 0,33 h at R450 + 15% VAT (' || t || ')');
  select count(*) into n from public.time_entries where invoice_id = inv;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' the entries are marked invoiced');
  begin
    perform public.invoice_time_entries(p, array[e1]);
    r := r || 'FAIL hours are invoiced once only'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS hours are invoiced once only'::text;
  end;
  begin
    perform public.invoice_time_entries(p, array[e3]);
    r := r || 'FAIL non-billable time is not invoiced'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS non-billable time is not invoiced'::text;
  end;
  begin
    update public.time_entries set ended_at = ended_at + interval '1 hour' where id = e1;
    select count(*) into n from public.time_entries where id = e1 and ended_at = '2026-11-10 08:30+00';
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' invoiced time cannot be changed');
  exception when insufficient_privilege or sqlstate 'LDG03' then r := r || 'PASS invoiced time cannot be changed'::text;
  end;
  insert into public.time_entries (workspace_id, project_id, started_at, ended_at) values (ws, p_norate, '2026-11-11 07:00+00', '2026-11-11 08:00+00') returning id into e2;
  begin
    perform public.invoice_time_entries(p_norate, array[e2]);
    r := r || 'FAIL a project needs an hourly rate to bill time'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a project needs an hourly rate to bill time'::text;
  end;
  insert into public.time_entries (workspace_id, project_id, started_at, ended_at) values (ws, p_noclient, '2026-11-11 07:00+00', '2026-11-11 08:00+00') returning id into e2;
  begin
    perform public.invoice_time_entries(p_noclient, array[e2]);
    r := r || 'FAIL a project needs a client to bill time'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a project needs a client to bill time'::text;
  end;

  -- deleting the draft frees the hours
  delete from public.sales_documents where id = inv;
  select count(*) into n from public.time_entries where id = e1 and invoice_id is null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' deleting the draft frees the hours to bill again');
  inv2 := public.invoice_time_entries(p, array[e1]);
  r := r || (case when inv2 is not null then 'PASS' else 'FAIL' end || ' and they can be invoiced again');
  reset role;

  -- accountant and another workspace
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.time_entries where workspace_id = ws;
  r := r || (case when n >= 5 then 'PASS' else 'FAIL' end || ' accountants can see time');
  begin
    perform public.start_timer(ws, p, null, 'x');
    r := r || 'FAIL accountants cannot track time'::text;
  exception when insufficient_privilege then r := r || 'PASS accountants cannot track time'::text;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.time_entries where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s time');
  begin
    perform public.invoice_time_entries(p, array[e3]);
    r := r || 'FAIL another workspace cannot invoice A''s time'::text;
  exception when no_data_found then r := r || 'PASS another workspace cannot invoice A''s time'::text;
  end;
  begin
    insert into public.time_entries (workspace_id, project_id, started_at, ended_at) values (ws_b, p, now() - interval '1 hour', now()) returning id into e_bob;
    r := r || 'FAIL time cannot be logged against another workspace''s project'::text;
  exception when foreign_key_violation then r := r || 'PASS time cannot be logged against another workspace''s project'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'TIME TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
