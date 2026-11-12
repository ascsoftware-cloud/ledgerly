-- Tests for 0009_sales. Ends by raising "SALES TESTS: n passed, m failed" (rolls back).
-- The line maths fixtures are the same ones as src/lib/money.test.ts ("parity with the database").
do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb; ln record;
  alice uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws_a uuid; ws_b uuid; c_a uuid; c_b uuid;
  inv1 uuid; inv2 uuid; quo uuid; empty uuid; conv uuid; conv2 uuid; cn uuid; cn2 uuid; extra uuid;
  three_lines jsonb := '[{"description":"Labour","quantity":3,"unit_cents":3333,"vat_rate":15},
                         {"description":"Parts","quantity":1,"unit_cents":999,"discount_pct":10,"vat_rate":15},
                         {"description":"Call-out","quantity":7,"unit_cents":143,"vat_rate":0}]';
  one_line jsonb := '[{"description":"Consulting","quantity":1,"unit_cents":10001,"vat_rate":0}]';
  i int;
  passed int; failed int;
begin
  -- ------------------------------------------------------------ maths parity
  select * into ln from app.calc_line(3, 3333, 0, 15::smallint);
  r := r || (case when (ln.net, ln.vat, ln.gross) = (9999, 1500, 11499) then 'PASS' else 'FAIL' end || ' 3 × R33,33 at 15% = 9999 + 1500');
  select * into ln from app.calc_line(0.5, 3333, 12.5, 15::smallint);
  r := r || (case when (ln.net, ln.vat, ln.gross) = (1458, 219, 1677) then 'PASS' else 'FAIL' end || ' half quantity and 12.5% discount round per line');
  select * into ln from app.calc_line(1.005, 1000, 0, 0::smallint);
  r := r || (case when ln.net = 1005 then 'PASS' else 'FAIL' end || ' exact halves round up (1.005 × 1000 = 1005)');
  select * into ln from app.calc_line(0.5, 1, 0, 0::smallint);
  r := r || (case when ln.net = 1 then 'PASS' else 'FAIL' end || ' half a cent rounds up to 1');
  select * into ln from app.calc_line(4, 2500, 100, 15::smallint);
  r := r || (case when ln.gross = 0 then 'PASS' else 'FAIL' end || ' 100% discount is zero');

  -- ------------------------------------------------------------ fixtures
  insert into auth.users (id, email) values (alice, 'alice@sales.test'), (acc, 'acc@sales.test'), (bob, 'bob@sales.test');
  insert into public.workspaces (slug, name, created_by) values ('sales-test-a', 'A', alice) returning id into ws_a;
  insert into public.workspaces (slug, name, created_by) values ('sales-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws_a, alice, 'owner'), (ws_a, acc, 'accountant'), (ws_b, bob, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws_a), (ws_b);
  insert into public.quest_steps (workspace_id, key, position) values (ws_a, 'first_invoice', 1);
  insert into public.contacts (workspace_id, name) values (ws_a, 'Thandi') returning id into c_a;
  insert into public.contacts (workspace_id, name) values (ws_b, 'Bea') returning id into c_b;

  -- ------------------------------------------------------------ Alice
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;

  inv1 := public.save_document_draft(ws_a, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), three_lines);
  select subtotal_cents || '/' || vat_cents || '/' || total_cents into t from public.sales_documents where id = inv1;
  r := r || (case when t = '11899/1635/13534' then 'PASS' else 'FAIL' end || ' draft totals = sum of rounded lines (' || t || ')');
  select count(*) into n from public.sales_documents where id = inv1 and status = 'draft' and number is null and created_by = alice;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a new invoice is an unnumbered draft');

  perform public.save_document_draft(ws_a, inv1,
    jsonb_build_object('kind', 'invoice', 'contact_id', c_a, 'deposit_type', 'pct', 'deposit_value', 50), one_line);
  select total_cents || '/' || deposit_cents into t from public.sales_documents where id = inv1;
  r := r || (case when t = '10001/5001' then 'PASS' else 'FAIL' end || ' re-saving replaces lines; 50% deposit of 10001 = 5001 (' || t || ')');
  perform public.save_document_draft(ws_a, inv1, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), three_lines);

  res := public.send_document(inv1);
  r := r || (case when res ->> 'number' = 'INV-0001' then 'PASS' else 'FAIL' end || ' first invoice is INV-0001 (' || (res ->> 'number') || ')');
  res := public.send_document(inv1);
  r := r || (case when res ->> 'number' = 'INV-0001' and (res ->> 'already_sent')::boolean then 'PASS' else 'FAIL' end || ' sending twice keeps the same number');
  select count(*) into n from public.sales_documents where id = inv1 and status = 'sent' and due_date = issue_date + 14;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' sent invoices are due in 14 days by default');
  select count(*) into n from public.activities where ref_id = inv1 and kind = 'invoice_sent' and summary = 'Invoice INV-0001 sent';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' sending writes the client timeline');
  select count(*) into n from public.xp_events where workspace_id = ws_a and kind = 'invoice_sent' and points = 20;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' sending an invoice earns 20 XP');
  select count(*) into n from public.quest_steps where workspace_id = ws_a and key = 'first_invoice' and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' first invoice ticks the quest step');

  inv2 := public.save_document_draft(ws_a, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), one_line);
  quo := public.save_document_draft(ws_a, null, jsonb_build_object('kind', 'quote', 'contact_id', c_a), three_lines);
  res := public.send_document(quo);
  r := r || (case when res ->> 'number' = 'QUO-0001' then 'PASS' else 'FAIL' end || ' quotes have their own numbers (QUO-0001)');
  res := public.send_document(inv2);
  r := r || (case when res ->> 'number' = 'INV-0002' then 'PASS' else 'FAIL' end || ' second invoice is INV-0002');

  -- Sent documents are locked.
  update public.sales_documents set notes = 'changed' where id = inv1; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a sent invoice cannot be edited');
  begin
    insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents)
      values (ws_a, inv1, 9, 'Sneaky extra', 1, 100000);
    r := r || 'FAIL lines cannot be added to a sent invoice'::text;
  exception when sqlstate 'LDG02' then r := r || 'PASS lines cannot be added to a sent invoice'::text;
  end;
  begin
    update public.sales_document_lines set unit_cents = 1 where document_id = inv1;
    r := r || 'FAIL lines of a sent invoice cannot be changed'::text;
  exception when sqlstate 'LDG02' then r := r || 'PASS lines of a sent invoice cannot be changed'::text;
  end;
  delete from public.sales_documents where id = inv1; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a sent invoice cannot be deleted');
  begin
    perform public.save_document_draft(ws_a, inv1, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), one_line);
    r := r || 'FAIL a sent invoice cannot be re-saved as a draft'::text;
  exception when no_data_found or sqlstate 'LDG02' then r := r || 'PASS a sent invoice cannot be re-saved as a draft'::text;
  end;

  empty := public.save_document_draft(ws_a, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), '[]');
  begin
    perform public.send_document(empty);
    r := r || 'FAIL an empty invoice cannot be sent'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS an empty invoice cannot be sent'::text;
  end;
  delete from public.sales_documents where id = empty; get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a draft can be deleted');

  -- Quote → invoice, once.
  conv := public.convert_quote_to_invoice(quo);
  conv2 := public.convert_quote_to_invoice(quo);
  select count(*) into n from public.sales_documents where id = conv and kind = 'invoice' and status = 'draft' and source_id = quo and total_cents = 13534;
  r := r || (case when n = 1 and conv = conv2 then 'PASS' else 'FAIL' end || ' a quote becomes one draft invoice with the same lines');

  -- Credit notes reduce what's owed.
  cn := public.create_credit_note(inv1);
  res := public.send_document(cn);
  select credited_cents || '/' || status into t from public.sales_documents where id = inv1;
  r := r || (case when res ->> 'number' = 'CN-0001' and t = '13534/paid' then 'PASS' else 'FAIL' end
             || ' a full credit note settles the invoice (' || coalesce(res ->> 'number', '?') || ', ' || t || ')');
  cn2 := public.create_credit_note(inv1);
  begin
    perform public.send_document(cn2);
    r := r || 'FAIL credit notes cannot exceed what is left'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS credit notes cannot exceed what is left'::text;
  end;
  delete from public.sales_documents where id = cn2;

  begin
    perform public.void_document(inv1);
    r := r || 'FAIL a credited invoice cannot be voided'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a credited invoice cannot be voided'::text;
  end;
  perform public.void_document(inv2);
  select count(*) into n from public.sales_documents where id = inv2 and status = 'void' and number = 'INV-0002';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' voiding keeps the number');

  -- Free plan: 10 invoices and quotes a month. Sent so far this month: INV-0001, QUO-0001, INV-0002.
  for i in 1..7 loop
    extra := public.save_document_draft(ws_a, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), one_line);
    perform public.send_document(extra);
  end loop;
  select number into t from public.sales_documents where id = extra;
  r := r || (case when t = 'INV-0009' then 'PASS' else 'FAIL' end || ' numbers stay gapless after a void (' || t || ')');
  extra := public.save_document_draft(ws_a, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), one_line);
  begin
    perform public.send_document(extra);
    r := r || 'FAIL the 11th send on the Free plan is refused'::text;
  exception when sqlstate 'LDG01' then r := r || 'PASS the 11th send on the Free plan is refused'::text;
  end;
  select count(*) into n from public.sales_documents where id = extra and status = 'draft' and number is null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a refused send uses no number and stays a draft');

  reset role;
  update public.workspaces set plan = 'pro' where id = ws_a;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.send_document(extra);
  r := r || (case when res ->> 'number' = 'INV-0010' then 'PASS' else 'FAIL' end || ' Pro has no monthly limit (' || (res ->> 'number') || ')');

  -- ------------------------------------------------------------ Bob (other workspace)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sales_documents where workspace_id = ws_a;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' B cannot read A''s invoices');
  select count(*) into n from public.sales_document_lines where workspace_id = ws_a;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' B cannot read A''s invoice lines');
  begin
    perform public.send_document(conv);
    r := r || 'FAIL B cannot send A''s draft'::text;
  exception when no_data_found then r := r || 'PASS B cannot send A''s draft'::text;
  end;
  begin
    perform public.convert_quote_to_invoice(quo);
    r := r || 'FAIL B cannot convert A''s quote'::text;
  exception when no_data_found then r := r || 'PASS B cannot convert A''s quote'::text;
  end;
  begin
    perform public.save_document_draft(ws_b, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), one_line);
    r := r || 'FAIL B cannot invoice A''s client'::text;
  exception when foreign_key_violation then r := r || 'PASS B cannot invoice A''s client'::text;
  end;
  begin
    perform public.save_document_draft(ws_a, conv, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), one_line);
    r := r || 'FAIL B cannot overwrite A''s draft'::text;
  exception when no_data_found or insufficient_privilege then r := r || 'PASS B cannot overwrite A''s draft'::text;
  end;

  -- ------------------------------------------------------------ accountant
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sales_documents where workspace_id = ws_a;
  r := r || (case when n > 0 then 'PASS' else 'FAIL' end || ' accountant can read invoices');
  begin
    perform public.save_document_draft(ws_a, null, jsonb_build_object('kind', 'invoice', 'contact_id', c_a), one_line);
    r := r || 'FAIL accountant cannot create invoices'::text;
  exception when insufficient_privilege then r := r || 'PASS accountant cannot create invoices'::text;
  end;
  begin
    perform public.send_document(conv);
    r := r || 'FAIL accountant cannot send invoices'::text;
  exception when no_data_found then r := r || 'PASS accountant cannot send invoices'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'SALES TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
