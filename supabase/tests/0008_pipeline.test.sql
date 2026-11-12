-- Tests for 0008_pipeline. Ends by raising "PIPELINE TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text;
  alice uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws_a uuid; ws_b uuid;
  lead_a uuid; won_a uuid; stage_b uuid;
  c_a uuid; c_b uuid; d_a uuid; d_b uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@pipe.test'), (acc, 'acc@pipe.test'), (bob, 'bob@pipe.test');
  insert into public.workspaces (slug, name, created_by) values ('pipe-test-a', 'A', alice) returning id into ws_a;
  insert into public.workspaces (slug, name, created_by) values ('pipe-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws_a, alice, 'owner'), (ws_a, acc, 'accountant'), (ws_b, bob, 'owner');

  select string_agg(name, ',' order by position) into t from public.pipeline_stages where workspace_id = ws_a;
  r := r || (case when t = 'New lead,In talks,Quote sent,Won,Lost' then 'PASS' else 'FAIL' end || ' new workspaces get a pipeline (' || coalesce(t, 'none') || ')');
  select id into lead_a from public.pipeline_stages where workspace_id = ws_a and position = 1;
  select id into won_a from public.pipeline_stages where workspace_id = ws_a and outcome = 'won';
  select id into stage_b from public.pipeline_stages where workspace_id = ws_b and position = 1;
  insert into public.contacts (workspace_id, name) values (ws_b, 'Bea') returning id into c_b;
  insert into public.deals (workspace_id, stage_id, title) values (ws_b, stage_b, 'B deal') returning id into d_b;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.contacts (workspace_id, name) values (ws_a, 'Thandi') returning id into c_a;
  insert into public.deals (workspace_id, stage_id, contact_id, title, value_cents)
    values (ws_a, lead_a, c_a, 'Bathroom revamp', 4500000) returning id into d_a;
  r := r || (case when d_a is not null then 'PASS' else 'FAIL' end || ' owner can add a deal');

  update public.deals set stage_id = won_a where id = d_a;
  select count(*) into n from public.deals where id = d_a and closed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' moving to Won marks the deal closed');
  select count(*) into n from public.activities where contact_id = c_a and kind = 'deal_moved' and summary = 'Bathroom revamp moved to Won';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the move shows on the client''s timeline');
  update public.deals set stage_id = lead_a where id = d_a;
  select count(*) into n from public.deals where id = d_a and closed_at is null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' moving back to an open stage reopens it');

  select count(*) into n from public.deals where id = d_b;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read B''s deals');
  select count(*) into n from public.pipeline_stages where workspace_id = ws_b;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read B''s stages');
  update public.deals set title = 'x' where id = d_b; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot edit B''s deals');
  begin
    update public.deals set stage_id = stage_b where id = d_a;
    r := r || 'FAIL a deal cannot move into another workspace''s stage'::text;
  exception when foreign_key_violation then r := r || 'PASS a deal cannot move into another workspace''s stage'::text;
  end;
  begin
    insert into public.deals (workspace_id, stage_id, contact_id, title) values (ws_a, lead_a, c_b, 'Cross');
    r := r || 'FAIL a deal cannot point at another workspace''s client'::text;
  exception when foreign_key_violation then r := r || 'PASS a deal cannot point at another workspace''s client'::text;
  end;
  begin
    insert into public.deals (workspace_id, stage_id, title, value_cents) values (ws_a, lead_a, 'Negative', -1);
    r := r || 'FAIL deal values cannot be negative'::text;
  exception when check_violation then r := r || 'PASS deal values cannot be negative'::text;
  end;
  begin
    insert into public.pipeline_stages (workspace_id, name, position) values (ws_a, 'Extra', 6);
    r := r || 'FAIL stages cannot be added directly'::text;
  exception when insufficient_privilege then r := r || 'PASS stages cannot be added directly'::text;
  end;
  update public.pipeline_stages set name = 'Enquiry' where id = lead_a; get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' owner can rename a stage');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.deals where workspace_id = ws_a;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' accountant can read deals');
  update public.deals set stage_id = won_a where id = d_a; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' accountant cannot move deals');
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'PIPELINE TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
