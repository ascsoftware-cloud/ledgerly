-- Tests for 0029_reports: a fixture business with hand-computed figures. Ends by raising
-- "REPORT TESTS: n passed, m failed" (rolls back).

create function pg_temp.probe(uid uuid, q text) returns int language plpgsql as $f$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
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

-- A sent (or void) document with lines, dated as given. Totals come from the real line triggers.
create function pg_temp.mkdoc(ws uuid, c uuid, k text, num text, st text, issued date, due date, lines jsonb,
                              paid bigint default 0, credited bigint default 0, src uuid default null)
returns uuid language plpgsql as $f$
declare d uuid; l jsonb; i int := 0;
begin
  insert into public.sales_documents (workspace_id, kind, contact_id, issue_date, due_date, source_id)
  values (ws, k, c, issued, due, src) returning id into d;
  for l in select * from jsonb_array_elements(lines) loop
    i := i + 1;
    insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate)
    values (ws, d, i, 'Line ' || i, (l ->> 'q')::numeric, (l ->> 'u')::bigint, (l ->> 'v')::smallint);
  end loop;
  if st <> 'draft' then
    update public.sales_documents
    set status = st, number = num, sent_at = issued::timestamptz, paid_cents = paid, credited_cents = credited
    where id = d;
  end if;
  return d;
end
$f$;

do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb;
  olga uuid := gen_random_uuid(); adam uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws2 uuid; c1 uuid; c2 uuid; c_eve uuid; a uuid; fuel uuid; rent uuid;
  passed int; failed int;
  -- reports
  pnl jsonb; vat jsonb; aged jsonb; cash jsonb; w jsonb;
begin
  insert into auth.users (id, email) values
    (olga, 'olga@rep.test'), (adam, 'adam@rep.test'), (sam, 'sam@rep.test'), (acc, 'acc@rep.test'), (eve, 'eve@rep.test');
  insert into public.workspaces (slug, name, created_by) values ('rep-test-a', 'Olga', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('rep-test-b', 'Eve', eve) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values
    (ws, olga, 'owner'), (ws, adam, 'admin'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id, vat_registered) values (ws, true), (ws2, false);
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c1;
  insert into public.contacts (workspace_id, name) values (ws, 'Bongani') returning id into c2;
  insert into public.contacts (workspace_id, name) values (ws2, 'Eve client') returning id into c_eve;
  select id into fuel from public.expense_categories where workspace_id = ws and name = 'Fuel and travel';
  select id into rent from public.expense_categories where workspace_id = ws and name = 'Rent';

  -- Invoices (all amounts in cents)
  a := pg_temp.mkdoc(ws, c1, 'invoice', 'INV-1', 'sent', '2026-10-05', '2026-10-19', '[{"q":2,"u":100000,"v":15}]', 0, 57500);   -- 200000 + 30000 VAT, 57500 credited
  perform pg_temp.mkdoc(ws, c2, 'invoice', 'INV-2', 'part_paid', '2026-10-20', '2026-11-03', '[{"q":1,"u":50000,"v":0}]', 20000);      -- 50000, 20000 paid
  perform pg_temp.mkdoc(ws, c1, 'invoice', 'INV-3', 'sent', '2026-09-15', '2026-09-29', '[{"q":1,"u":80000,"v":15}]');               -- 80000 + 12000
  perform pg_temp.mkdoc(ws, c1, 'invoice', 'INV-4', 'void', '2026-10-10', '2026-10-24', '[{"q":1,"u":99900,"v":15}]');              -- void: excluded
  perform pg_temp.mkdoc(ws, c1, 'invoice', null, 'draft', '2026-10-12', null, '[{"q":1,"u":88800,"v":15}]');                        -- draft: excluded
  perform pg_temp.mkdoc(ws, c2, 'invoice', 'INV-6', 'sent', '2026-11-06', '2026-11-20', '[{"q":1,"u":10000,"v":0}]');               -- due after the aged date
  perform pg_temp.mkdoc(ws, c2, 'invoice', 'INV-7', 'sent', '2026-06-15', '2026-07-01', '[{"q":1,"u":5000,"v":0}]');                -- long overdue
  perform pg_temp.mkdoc(ws, c1, 'quote', 'QUO-1', 'sent', '2026-10-06', '2026-11-05', '[{"q":1,"u":777000,"v":15}]');               -- quotes are not income
  perform pg_temp.mkdoc(ws, c1, 'credit_note', 'CN-1', 'sent', '2026-10-25', null, '[{"q":1,"u":50000,"v":15}]', 0, 0, a);          -- 50000 + 7500
  perform pg_temp.mkdoc(ws2, c_eve, 'invoice', 'INV-1', 'sent', '2026-10-05', '2026-10-19', '[{"q":1,"u":9999900,"v":15}]');         -- another business

  -- Expenses
  insert into public.expenses (workspace_id, spent_on, amount_cents, vat_cents, category_id, payment_method) values
    (ws, '2026-10-03', 11500, 1500, fuel, 'card'),
    (ws, '2026-10-15', 30000, 0, rent, 'eft'),
    (ws, '2026-10-31', 5750, 750, null, 'cash'),
    (ws, '2026-11-01', 99999, 0, rent, 'cash');
  insert into public.expenses (workspace_id, spent_on, amount_cents, vat_cents, category_id, payment_method, deleted_at)
  values (ws, '2026-10-10', 12345, 0, fuel, 'cash', now());
  insert into public.expenses (workspace_id, spent_on, amount_cents, payment_method) values (ws2, '2026-10-10', 888888, 'cash');

  -- Repeating costs
  insert into public.recurring_costs (workspace_id, supplier, amount_cents, cadence, next_date, anchor_day, category_id) values
    (ws, 'Landlord', 30000, 'monthly', '2026-11-15', 15, rent),
    (ws, 'Cleaner', 1000, 'weekly', '2026-11-12', 12, null),
    (ws, 'Insurance', 120000, 'yearly', '2026-12-01', 1, null);
  insert into public.recurring_costs (workspace_id, supplier, amount_cents, cadence, next_date, anchor_day, active)
  values (ws, 'Stopped', 77777, 'monthly', '2026-11-20', 20, false);

  -- ------------------------------------------------------------ profit and loss
  perform set_config('request.jwt.claims', json_build_object('sub', adam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  pnl := public.report_pnl(ws, '2026-10-01', '2026-10-31');
  reset role;
  r := r || (case when (pnl ->> 'income_cents')::bigint = 250000 then 'PASS' else 'FAIL' end || ' P&L income = invoices sent in October ex VAT, no void, draft or quote (' || (pnl ->> 'income_cents') || ')');
  r := r || (case when (pnl ->> 'credit_cents')::bigint = 50000 then 'PASS' else 'FAIL' end || ' credit notes (' || (pnl ->> 'credit_cents') || ')');
  r := r || (case when (pnl ->> 'net_income_cents')::bigint = 200000 then 'PASS' else 'FAIL' end || ' net income (' || (pnl ->> 'net_income_cents') || ')');
  r := r || (case when (pnl ->> 'expenses_cents')::bigint = 45000 then 'PASS' else 'FAIL' end || ' expenses ex claimable VAT, no deleted or other-month ones (' || (pnl ->> 'expenses_cents') || ')');
  r := r || (case when (pnl ->> 'profit_cents')::bigint = 155000 then 'PASS' else 'FAIL' end || ' profit (' || (pnl ->> 'profit_cents') || ')');
  r := r || (case when (pnl ->> 'invoice_count')::int = 2 then 'PASS' else 'FAIL' end || ' two invoices (' || (pnl ->> 'invoice_count') || ')');
  select string_agg((x ->> 'category') || '=' || (x ->> 'cents'), ', ' order by x ->> 'category') into t
  from jsonb_array_elements(pnl -> 'expenses_by_category') x;
  r := r || (case when t = 'Fuel and travel=10000, Rent=30000, Uncategorised=5000' then 'PASS' else 'FAIL' end || ' expenses by category (' || t || ')');

  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  pnl := public.report_pnl(ws, '2026-12-01', '2026-12-31');
  reset role;
  r := r || (case when (pnl ->> 'profit_cents')::bigint = 0 and jsonb_array_length(pnl -> 'expenses_by_category') = 0 then 'PASS' else 'FAIL' end || ' an empty month is zero, not an error');
  r := r || (case when pg_temp.probe(olga, format($q$select public.report_pnl('%s', '2026-10-31', '2026-10-01')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' a range that ends before it starts is refused');
  r := r || (case when pg_temp.probe(olga, format($q$select public.report_pnl('%s', '2010-01-01', '2026-10-01')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' so is a range of more than five years');

  -- ------------------------------------------------------------------ VAT
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  vat := public.report_vat(ws, '2026-10-01', '2026-10-31');
  reset role;
  r := r || (case when (vat ->> 'output_vat_cents')::bigint = 22500 then 'PASS' else 'FAIL' end || ' output VAT = invoices 30000 less credit note 7500 (' || (vat ->> 'output_vat_cents') || ')');
  r := r || (case when (vat ->> 'input_vat_cents')::bigint = 2250 then 'PASS' else 'FAIL' end || ' input VAT from expenses (' || (vat ->> 'input_vat_cents') || ')');
  r := r || (case when (vat ->> 'net_vat_cents')::bigint = 20250 then 'PASS' else 'FAIL' end || ' VAT payable (' || (vat ->> 'net_vat_cents') || ')');
  r := r || (case when (vat ->> 'standard_rated_cents')::bigint = 150000 and (vat ->> 'zero_rated_cents')::bigint = 50000 then 'PASS' else 'FAIL' end
              || ' standard-rated 150000 and zero-rated 50000 sales (' || (vat ->> 'standard_rated_cents') || '/' || (vat ->> 'zero_rated_cents') || ')');
  r := r || (case when (vat ->> 'vat_registered')::boolean then 'PASS' else 'FAIL' end || ' knows the business is VAT registered');

  -- ----------------------------------------------------------- aged debtors
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  aged := public.report_aged_debtors(ws, '2026-11-10');
  reset role;
  r := r || (case when (aged -> 'totals' ->> 'current')::bigint = 10000 then 'PASS' else 'FAIL' end || ' not yet due (' || (aged -> 'totals' ->> 'current') || ')');
  r := r || (case when (aged -> 'totals' ->> 'd1_30')::bigint = 202500 then 'PASS' else 'FAIL' end || ' 1-30 days: 172500 + 30000 (' || (aged -> 'totals' ->> 'd1_30') || ')');
  r := r || (case when (aged -> 'totals' ->> 'd31_60')::bigint = 92000 then 'PASS' else 'FAIL' end || ' 31-60 days (' || (aged -> 'totals' ->> 'd31_60') || ')');
  r := r || (case when (aged -> 'totals' ->> 'd61_90')::bigint = 0 then 'PASS' else 'FAIL' end || ' 61-90 days is empty');
  r := r || (case when (aged -> 'totals' ->> 'over_90')::bigint = 5000 then 'PASS' else 'FAIL' end || ' over 90 days (' || (aged -> 'totals' ->> 'over_90') || ')');
  r := r || (case when (aged -> 'totals' ->> 'total')::bigint = 309500 then 'PASS' else 'FAIL' end || ' total owed 309500 (' || (aged -> 'totals' ->> 'total') || ')');
  r := r || (case when jsonb_array_length(aged -> 'rows') = 5 then 'PASS' else 'FAIL' end || ' five open invoices listed');
  select string_agg((x ->> 'contact') || '=' || (x ->> 'total_cents'), ', ' order by x ->> 'contact') into t from jsonb_array_elements(aged -> 'by_client') x;
  r := r || (case when t = 'Bongani=45000, Thandi=264500' then 'PASS' else 'FAIL' end || ' by client (' || t || ')');
  select (x ->> 'days_overdue') into t from jsonb_array_elements(aged -> 'rows') x where x ->> 'number' = 'INV-3';
  r := r || (case when t = '42' then 'PASS' else 'FAIL' end || ' INV-3 is 42 days overdue (' || coalesce(t, 'none') || ')');

  -- ------------------------------------------------------------- cash flow
  perform set_config('request.jwt.claims', json_build_object('sub', adam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cash := public.report_cashflow(ws, '2026-11-10');
  reset role;
  r := r || (case when jsonb_array_length(cash -> 'weeks') = 13 then 'PASS' else 'FAIL' end || ' 13 weekly buckets');
  r := r || (case when (cash -> 'weeks' -> 0 ->> 'start') = '2026-11-10' and (cash -> 'weeks' -> 1 ->> 'start') = '2026-11-17' then 'PASS' else 'FAIL' end || ' starting today');
  r := r || (case when (cash -> 'weeks' -> 0 ->> 'in_cents')::bigint = 299500 then 'PASS' else 'FAIL' end || ' week 1 in: every overdue invoice lands now (' || (cash -> 'weeks' -> 0 ->> 'in_cents') || ')');
  r := r || (case when (cash -> 'weeks' -> 1 ->> 'in_cents')::bigint = 10000 then 'PASS' else 'FAIL' end || ' week 2 in: INV-6 on its due date (' || (cash -> 'weeks' -> 1 ->> 'in_cents') || ')');
  r := r || (case when (cash ->> 'total_in_cents')::bigint = 309500 then 'PASS' else 'FAIL' end || ' all open invoices come in (' || (cash ->> 'total_in_cents') || ')');
  select string_agg((x ->> 'out_cents'), ',' order by ord) into t from jsonb_array_elements(cash -> 'weeks') with ordinality as w (x, ord);
  r := r || (case when t = '31000,1000,1000,121000,1000,31000,1000,1000,1000,31000,1000,1000,1000' then 'PASS' else 'FAIL' end || ' weekly out: rent, cleaner, insurance, none for the stopped cost (' || t || ')');
  r := r || (case when (cash ->> 'total_out_cents')::bigint = 223000 then 'PASS' else 'FAIL' end || ' total out (' || (cash ->> 'total_out_cents') || ')');
  r := r || (case when (cash -> 'weeks' -> 0 ->> 'net_cents')::bigint = 268500 and (cash -> 'weeks' -> 1 ->> 'running_cents')::bigint = 268500 + 9000 then 'PASS' else 'FAIL' end
              || ' net and running total (' || (cash -> 'weeks' -> 0 ->> 'net_cents') || ', ' || (cash -> 'weeks' -> 1 ->> 'running_cents') || ')');

  -- ------------------------------------------------- who may ask, and isolation
  r := r || (case when pg_temp.probe(sam, format($q$select public.report_pnl('%s', '2026-10-01', '2026-10-31')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' staff are refused P&L');
  r := r || (case when pg_temp.probe(sam, format($q$select public.report_vat('%s', '2026-10-01', '2026-10-31')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' staff are refused VAT');
  r := r || (case when pg_temp.probe(sam, format($q$select public.report_aged_debtors('%s', '2026-11-10')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' staff are refused aged debtors');
  r := r || (case when pg_temp.probe(sam, format($q$select public.report_cashflow('%s', '2026-11-10')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' staff are refused the forecast');
  r := r || (case when pg_temp.probe(eve, format($q$select public.report_pnl('%s', '2026-10-01', '2026-10-31')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' another business cannot read these reports');
  r := r || (case when pg_temp.probe(acc, format($q$select public.report_pnl('%s', '2026-10-01', '2026-10-31')$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' the accountant can');
  r := r || (case when pg_temp.probe(acc, format($q$select public.report_cashflow('%s', '2026-11-10')$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' and can see the forecast');
  r := r || (case when pg_temp.probe(acc, format($q$select public.report_pnl('%s', '2026-10-01', '2026-10-31')$q$, ws2)) = -1 then 'PASS' else 'FAIL' end || ' but not another business''s');

  perform set_config('request.jwt.claims', json_build_object('sub', eve, 'role', 'authenticated')::text, true);
  set local role authenticated;
  pnl := public.report_pnl(ws2, '2026-10-01', '2026-10-31');
  reset role;
  r := r || (case when (pnl ->> 'income_cents')::bigint = 9999900 and (pnl ->> 'expenses_cents')::bigint = 888888 then 'PASS' else 'FAIL' end || ' each business sees only its own numbers (' || (pnl ->> 'income_cents') || ')');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'REPORT TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
