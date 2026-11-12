-- Tests for 0020_expenses. Ends by raising "EXPENSE TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; e uuid; e2 uuid; cat uuid; cat_b uuid; rc uuid; rc2 uuid;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws uuid; ws_b uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@exp.test'), (sam, 'sam@exp.test'), (acc, 'acc@exp.test'), (bob, 'bob@exp.test');
  insert into public.workspaces (slug, name, created_by) values ('exp-test-a', 'A', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('exp-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws_b, bob, 'owner');
  insert into public.quest_steps (workspace_id, key, position) values (ws, 'first_expense', 1);

  select count(*) into n from public.expense_categories where workspace_id = ws;
  r := r || (case when n >= 10 then 'PASS' else 'FAIL' end || ' a new workspace gets standard expense categories (' || n || ')');
  select id into cat from public.expense_categories where workspace_id = ws and name = 'Fuel and travel';
  select id into cat_b from public.expense_categories where workspace_id = ws_b limit 1;

  -- ------------------------------------------------------------ staff logs an expense
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.expenses (workspace_id, spent_on, amount_cents, vat_cents, supplier, category_id, idempotency_key)
  values (ws, '2026-11-10', 115000, 15000, 'Engen', cat, 'manual:' || gen_random_uuid()) returning id into e;
  r := r || 'PASS staff can log an expense'::text;
  select count(*) into n from public.expenses where id = e and created_by = sam;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' it records who logged it');
  begin
    insert into public.expenses (workspace_id, spent_on, amount_cents, vat_cents) values (ws, '2026-11-10', 1000, 2000);
    r := r || 'FAIL VAT cannot be more than the amount'::text;
  exception when check_violation then r := r || 'PASS VAT cannot be more than the amount'::text;
  end;
  begin
    insert into public.expenses (workspace_id, spent_on, amount_cents) values (ws, '2026-11-10', 0);
    r := r || 'FAIL an expense needs an amount'::text;
  exception when check_violation then r := r || 'PASS an expense needs an amount'::text;
  end;
  begin
    insert into public.expenses (workspace_id, spent_on, amount_cents, category_id) values (ws, '2026-11-10', 1000, cat_b);
    r := r || 'FAIL another workspace''s category cannot be used'::text;
  exception when foreign_key_violation then r := r || 'PASS another workspace''s category cannot be used'::text;
  end;
  begin
    insert into public.expenses (workspace_id, spent_on, amount_cents, receipt_path) values (ws, '2026-11-10', 1000, ws_b || '/x/receipt.jpg');
    r := r || 'FAIL a receipt from another workspace cannot be attached'::text;
  exception when check_violation then r := r || 'PASS a receipt from another workspace cannot be attached'::text;
  end;
  begin
    insert into public.expenses (workspace_id, spent_on, amount_cents) values (ws_b, '2026-11-10', 1000);
    r := r || 'FAIL staff cannot log expenses in a workspace they are not in'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot log expenses in a workspace they are not in'::text;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', ws_b || '/' || gen_random_uuid() || '/r.jpg');
    r := r || 'FAIL receipts cannot be uploaded into another workspace''s folder'::text;
  exception when insufficient_privilege then r := r || 'PASS receipts cannot be uploaded into another workspace''s folder'::text;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', 'not-a-uuid/r.jpg');
    r := r || 'FAIL a malformed receipt path is refused, not an error'::text;
  exception when insufficient_privilege then r := r || 'PASS a malformed receipt path is refused, not an error'::text;
  end;
  reset role;

  select count(*) into n from public.xp_events where workspace_id = ws and kind = 'expense_logged';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' logging an expense earns XP once (' || n || ')');
  select count(*) into n from public.quest_steps where workspace_id = ws and key = 'first_expense' and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' it ticks "Log an expense"');

  -- ------------------------------------------------------------ accountant and other workspaces
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.expenses where workspace_id = ws;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' accountants can see expenses');
  begin
    insert into public.expenses (workspace_id, spent_on, amount_cents) values (ws, '2026-11-10', 1000);
    r := r || 'FAIL accountants cannot log expenses'::text;
  exception when insufficient_privilege then r := r || 'PASS accountants cannot log expenses'::text;
  end;
  update public.expenses set amount_cents = 1 where id = e;
  select amount_cents::text into t from public.expenses where id = e;
  r := r || (case when t = '115000' then 'PASS' else 'FAIL' end || ' accountants cannot change expenses');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.expenses where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s expenses');
  select count(*) into n from public.expense_categories where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' or A''s categories');
  update public.expenses set amount_cents = 1 where id = e;
  reset role;
  select amount_cents::text into t from public.expenses where id = e;
  r := r || (case when t = '115000' then 'PASS' else 'FAIL' end || ' another workspace cannot change A''s expenses');

  -- ------------------------------------------------------------ owner: edit, archive, categories
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.expenses set workspace_id = ws_b where id = e;
    r := r || 'FAIL an expense cannot move to another workspace'::text;
  exception when check_violation or insufficient_privilege then r := r || 'PASS an expense cannot move to another workspace'::text;
  end;
  update public.expenses set deleted_at = now() where id = e;
  select count(*) into n from public.expenses where id = e and deleted_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' expenses can be archived (undo-able)');
  delete from public.expense_categories where id = cat;
  reset role;
  select coalesce(category_id::text, 'none') into t from public.expenses where id = e;
  r := r || (case when t = 'none' then 'PASS' else 'FAIL' end || ' deleting a category keeps its expenses, uncategorised');

  -- ------------------------------------------------------------ recurring costs
  insert into public.recurring_costs (workspace_id, supplier, amount_cents, cadence, next_date, anchor_day, created_by)
  values (ws, 'Landlord', 800000, 'monthly', '2026-01-31', 31, alice) returning id into rc;
  insert into public.recurring_costs (workspace_id, supplier, amount_cents, cadence, next_date, anchor_day, created_by)
  values (ws, 'Insurer', 50000, 'yearly', '2027-03-01', 1, alice) returning id into rc2;
  set local role service_role;
  n := public.run_recurring_costs('2026-03-31');
  reset role;
  r := r || (case when n = 3 then 'PASS' else 'FAIL' end || ' missed months are caught up (' || n || ')');
  select string_agg(spent_on::text, ',' order by spent_on) into t from public.expenses where recurring_id = rc;
  r := r || (case when t = '2026-01-31,2026-02-28,2026-03-31' then 'PASS' else 'FAIL' end || ' month ends keep their anchor day (' || coalesce(t, 'none') || ')');
  select next_date::text into t from public.recurring_costs where id = rc;
  r := r || (case when t = '2026-04-30' then 'PASS' else 'FAIL' end || ' the next one is due on 30 April (' || t || ')');
  set local role service_role;
  n := public.run_recurring_costs('2026-03-31');
  reset role;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' running it again the same day adds nothing');
  select count(*) into n from public.expenses where recurring_id = rc2;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a cost not yet due is left alone');

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.run_recurring_costs('2026-12-31');
    r := r || 'FAIL users cannot run the recurring job'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot run the recurring job'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'EXPENSE TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
