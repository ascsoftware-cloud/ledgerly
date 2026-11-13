-- Tests for 0021_bank. Ends by raising "BANK TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb; imp uuid; l_in uuid; l_out uuid; l_big uuid; inv uuid; inv_b uuid; cat uuid; exp_id uuid;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws uuid; ws_b uuid; c uuid; c_b uuid;
  line jsonb := '[{"description":"Work","quantity":1,"unit_cents":230000,"vat_rate":0}]';
  lines jsonb := '[
    {"posted_on":"2026-11-01","amount_cents":-45000,"description":"POS ENGEN","key":"2026-11-01|-45000|pos engen|0"},
    {"posted_on":"2026-11-03","amount_cents":230000,"description":"EFT THANDI INV-0001","key":"2026-11-03|230000|eft thandi inv-0001|0"},
    {"posted_on":"2026-11-03","amount_cents":230000,"description":"EFT THANDI INV-0001","key":"2026-11-03|230000|eft thandi inv-0001|1"},
    {"posted_on":"2026-11-04","amount_cents":900000,"description":"BIG DEPOSIT","key":"2026-11-04|900000|big deposit|0"}
  ]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@bank.test'), (sam, 'sam@bank.test'), (acc, 'acc@bank.test'), (bob, 'bob@bank.test');
  insert into public.workspaces (slug, name, created_by) values ('bank-test-a', 'A', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('bank-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws_b, bob, 'owner'), (ws_b, alice, 'owner');
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;
  insert into public.contacts (workspace_id, name) values (ws_b, 'Bea') returning id into c_b;
  select id into cat from public.expense_categories where workspace_id = ws and name = 'Fuel and travel';

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  perform public.send_document(inv);
  inv_b := public.save_document_draft(ws_b, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_b), line);
  perform public.send_document(inv_b);

  res := public.import_bank_lines(ws, 'november.csv', lines);
  imp := (res ->> 'import_id')::uuid;
  r := r || (case when (res ->> 'added')::int = 4 and (res ->> 'duplicates')::int = 0 then 'PASS' else 'FAIL' end || ' a statement is imported, identical lines kept (' || res || ')');
  res := public.import_bank_lines(ws, 'november.csv', lines);
  r := r || (case when (res ->> 'added')::int = 0 and (res ->> 'duplicates')::int = 4 then 'PASS' else 'FAIL' end || ' re-importing the same file adds nothing (' || res || ')');
  select count(*) into n from public.bank_lines where workspace_id = ws;
  r := r || (case when n = 4 then 'PASS' else 'FAIL' end || ' still four lines');

  select id into l_out from public.bank_lines where workspace_id = ws and amount_cents = -45000;
  select id into l_in from public.bank_lines where workspace_id = ws and amount_cents = 230000 order by fingerprint limit 1;
  select id into l_big from public.bank_lines where workspace_id = ws and amount_cents = 900000;

  -- money in → invoice payment, once
  res := public.match_bank_line(l_in, inv);
  select status || '/' || paid_cents into t from public.sales_documents where id = inv;
  r := r || (case when t = 'paid/230000' then 'PASS' else 'FAIL' end || ' matching money in pays the invoice (' || t || ')');
  select count(*) into n from public.payments where document_id = inv and method = 'eft' and reference = 'EFT THANDI INV-0001';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the payment carries the bank description');
  begin
    perform public.match_bank_line(l_in, inv);
    r := r || 'FAIL a line cannot be matched twice'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a line cannot be matched twice'::text;
  end;
  begin
    perform public.match_bank_line(l_big, inv_b);
    r := r || 'FAIL a line cannot pay another workspace''s invoice'::text;
  exception when no_data_found then r := r || 'PASS a line cannot pay another workspace''s invoice'::text;
  end;
  begin
    perform public.match_bank_line(l_out, inv);
    r := r || 'FAIL money out cannot be matched to an invoice'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS money out cannot be matched to an invoice'::text;
  end;

  -- money out → expense, once
  exp_id := public.bank_line_to_expense(l_out, cat);
  select amount_cents || '/' || coalesce(supplier, '') || '/' || payment_method into t from public.expenses where id = exp_id;
  r := r || (case when t = '45000/POS ENGEN/eft' then 'PASS' else 'FAIL' end || ' money out becomes an expense (' || t || ')');
  begin
    perform public.bank_line_to_expense(l_out, cat);
    r := r || 'FAIL a line becomes an expense only once'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a line becomes an expense only once'::text;
  end;
  begin
    perform public.bank_line_to_expense(l_big, cat);
    r := r || 'FAIL money in cannot become an expense'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS money in cannot become an expense'::text;
  end;
  perform public.set_bank_line_ignored(l_big, true);
  select status into t from public.bank_lines where id = l_big;
  r := r || (case when t = 'ignored' then 'PASS' else 'FAIL' end || ' a line can be ignored (' || t || ')');
  reset role;

  -- staff, accountant, other workspaces
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.bank_lines where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' staff cannot see bank statements');
  begin
    perform public.import_bank_lines(ws, 'x.csv', lines);
    r := r || 'FAIL staff cannot import statements'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot import statements'::text;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.bank_lines where workspace_id = ws;
  r := r || (case when n = 4 then 'PASS' else 'FAIL' end || ' accountants can read the statement');
  begin
    perform public.set_bank_line_ignored(l_big, false);
    r := r || 'FAIL accountants cannot change lines'::text;
  exception when no_data_found then r := r || 'PASS accountants cannot change lines'::text;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.bank_lines where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s statement');
  begin
    perform public.import_bank_lines(ws, 'x.csv', lines);
    r := r || 'FAIL another workspace cannot import into A'::text;
  exception when insufficient_privilege then r := r || 'PASS another workspace cannot import into A'::text;
  end;
  begin
    insert into public.bank_lines (workspace_id, import_id, posted_on, amount_cents, description, fingerprint) values (ws_b, imp, '2026-11-01', 1, 'x', 'x');
    r := r || 'FAIL lines cannot be written directly'::text;
  exception when insufficient_privilege then r := r || 'PASS lines cannot be written directly'::text;
  end;
  reset role;

  -- deleting an import keeps the payments and expenses it created
  -- (Since 0026 people delete an unused import through delete_bank_import; this checks the cascade rule itself.)
  delete from public.bank_imports where id = imp;
  select count(*) into n from public.bank_lines where import_id = imp;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' deleting an import removes its lines');
  select count(*) into n from public.payments where document_id = inv;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' but keeps the payment it recorded');
  select count(*) into n from public.expenses where id = exp_id;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and the expense');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'BANK TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
