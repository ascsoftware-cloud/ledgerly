-- Tests for 0027_inventory. Ends by raising "INVENTORY TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws2 uuid; c uuid; sup uuid; prod uuid; prod2 uuid; svc uuid; other_prod uuid;
  inv uuid; inv2 uuid; q uuid; inv3 uuid; po uuid; po2 uuid; stock numeric; summed numeric;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@inv.test'), (sam, 'sam@inv.test'), (acc, 'acc@inv.test'), (eve, 'eve@inv.test');
  insert into public.workspaces (slug, name, created_by) values ('inv-test-a', 'A', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('inv-test-b', 'B', eve) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values
    (ws, alice, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws2);
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;

  -- staff can set up suppliers and products
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.suppliers (workspace_id, name, email) values (ws, 'Builders Warehouse', 'orders@bw.test') returning id into sup;
  insert into public.products (workspace_id, name, sku, cost_cents, price_cents, vat_rate, track_stock, reorder_level, supplier_id)
  values (ws, 'Floor tile', 'TILE-1', 6000, 9500, 15, true, 5, sup) returning id into prod;
  insert into public.products (workspace_id, name, sku, track_stock, price_cents)
  values (ws, 'Grout', 'GROUT-1', true, 4000) returning id into prod2;
  insert into public.products (workspace_id, name, kind, price_cents) values (ws, 'Consulting hour', 'service', 45000) returning id into svc;
  r := r || 'PASS staff create suppliers and products'::text;

  begin
    update public.products set stock_qty = 999 where id = prod;
    r := r || 'FAIL stock_qty can be edited directly'::text;
  exception when insufficient_privilege then r := r || 'PASS stock_qty cannot be edited directly'::text;
  end;
  begin
    insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values (ws, prod, 5, 'adjustment');
    r := r || 'FAIL a movement can be inserted directly'::text;
  exception when insufficient_privilege then r := r || 'PASS movements cannot be inserted directly'::text;
  end;
  begin
    insert into public.products (workspace_id, name, kind, track_stock) values (ws, 'Bad', 'service', true);
    r := r || 'FAIL a service can track stock'::text;
  exception when check_violation then r := r || 'PASS a service cannot track stock'::text;
  end;
  begin
    insert into public.products (workspace_id, name, sku) values (ws, 'Dup', 'tile-1');
    r := r || 'FAIL SKUs repeat (case differs)'::text;
  exception when unique_violation then r := r || 'PASS SKUs are unique per business, ignoring case'::text;
  end;
  reset role;
  insert into public.products (workspace_id, name, sku) values (ws2, 'Floor tile', 'TILE-1') returning id into other_prod;
  r := r || 'PASS the same SKU is fine in another business'::text;

  -- accountant reads but does not write
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.products where workspace_id = ws;
  r := r || (case when n = 3 then 'PASS' else 'FAIL' end || ' the accountant can read products (' || n || ')');
  begin
    insert into public.products (workspace_id, name) values (ws, 'Nope');
    r := r || 'FAIL the accountant created a product'::text;
  exception when insufficient_privilege or sqlstate '42501' then r := r || 'PASS the accountant cannot create products'::text;
  end;
  begin
    perform public.adjust_stock(prod, 5, 'adjustment', null);
    r := r || 'FAIL the accountant adjusted stock'::text;
  exception when no_data_found then r := r || 'PASS the accountant cannot adjust stock'::text;
  end;
  reset role;

  -- another business sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', eve, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.products where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another business sees no products (' || n || ')');
  select count(*) into n from public.suppliers where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another business sees no suppliers (' || n || ')');
  begin
    perform public.adjust_stock(prod, 5, 'adjustment', null);
    r := r || 'FAIL another business adjusted stock'::text;
  exception when no_data_found then r := r || 'PASS another business cannot adjust stock'::text;
  end;
  begin
    insert into public.purchase_orders (workspace_id, supplier_id) values (ws, sup);
    r := r || 'FAIL another business created a purchase order'::text;
  exception when insufficient_privilege or sqlstate '42501' then r := r || 'PASS another business cannot create purchase orders here'::text;
  end;
  reset role;

  -- manual stock: opening stock, then adjustments; the cache equals the sum of movements
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.adjust_stock(prod, 10, 'initial', 'Opening count');
  perform public.adjust_stock(prod, -3, 'adjustment', 'Broken in transit');
  begin
    perform public.adjust_stock(prod, 4, 'initial', null);
    r := r || 'FAIL opening stock set twice'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS opening stock can only be set once'::text;
  end;
  begin
    perform public.adjust_stock(svc, 1, 'adjustment', null);
    r := r || 'FAIL stock adjusted on a service'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS stock cannot be adjusted on an untracked product'::text;
  end;
  begin
    perform public.adjust_stock(prod, 0, 'adjustment', null);
    r := r || 'FAIL a zero adjustment was accepted'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a zero adjustment is refused'::text;
  end;
  select stock_qty into stock from public.products where id = prod;
  select coalesce(sum(qty_change), 0) into summed from public.stock_movements where product_id = prod;
  r := r || (case when stock = 7 and summed = 7 then 'PASS' else 'FAIL' end || ' stock (' || stock || ') equals the sum of movements (' || summed || ')');
  reset role;

  -- an invoice takes stock when it is sent; sending twice takes it once; voiding puts it back
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c),
    jsonb_build_array(jsonb_build_object('description', 'Floor tile', 'quantity', 2, 'unit_cents', 9500, 'vat_rate', 15, 'product_id', prod),
                      jsonb_build_object('description', 'Labour', 'quantity', 1, 'unit_cents', 20000, 'vat_rate', 0)));
  select stock_qty into stock from public.products where id = prod;
  r := r || (case when stock = 7 then 'PASS' else 'FAIL' end || ' a draft invoice does not touch stock (' || stock || ')');
  perform public.send_document(inv);
  perform public.send_document(inv);
  select stock_qty into stock from public.products where id = prod;
  r := r || (case when stock = 5 then 'PASS' else 'FAIL' end || ' sending takes 2 once, even when sent twice (' || stock || ')');
  select count(*) into n from public.stock_movements where product_id = prod and reason = 'sale';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' one sale movement (' || n || ')');
  perform public.void_document(inv);
  perform public.void_document(inv);
  select stock_qty into stock from public.products where id = prod;
  r := r || (case when stock = 7 then 'PASS' else 'FAIL' end || ' voiding restores the stock, once (' || stock || ')');
  select coalesce(sum(qty_change), 0) into summed from public.stock_movements where product_id = prod;
  r := r || (case when summed = stock then 'PASS' else 'FAIL' end || ' still equal to the sum of movements (' || summed || ')');

  -- quotes do not move stock; the invoice made from one does
  q := public.save_document_draft(ws, null, jsonb_build_object('kind', 'quote', 'contact_id', c),
    jsonb_build_array(jsonb_build_object('description', 'Floor tile', 'quantity', 3, 'unit_cents', 9500, 'vat_rate', 15, 'product_id', prod)));
  perform public.send_document(q);
  select stock_qty into stock from public.products where id = prod;
  r := r || (case when stock = 7 then 'PASS' else 'FAIL' end || ' sending a quote does not touch stock (' || stock || ')');
  inv3 := public.convert_quote_to_invoice(q);
  perform public.send_document(inv3);
  select stock_qty into stock from public.products where id = prod;
  r := r || (case when stock = 4 then 'PASS' else 'FAIL' end || ' an invoice made from a quote keeps the product (' || stock || ')');

  -- selling the last units: never blocked, always exact, and flagged
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c),
    jsonb_build_array(jsonb_build_object('description', 'Floor tile', 'quantity', 3, 'unit_cents', 9500, 'vat_rate', 15, 'product_id', prod)));
  inv2 := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c),
    jsonb_build_array(jsonb_build_object('description', 'Floor tile', 'quantity', 3, 'unit_cents', 9500, 'vat_rate', 15, 'product_id', prod)));
  perform public.send_document(inv);
  res := public.stock_warnings(inv);
  r := r || (case when jsonb_array_length(res) = 0 then 'PASS' else 'FAIL' end || ' no warning while stock is enough (' || res::text || ')');
  perform public.send_document(inv2);
  select stock_qty into stock from public.products where id = prod;
  select coalesce(sum(qty_change), 0) into summed from public.stock_movements where product_id = prod;
  r := r || (case when stock = -2 and summed = -2 then 'PASS' else 'FAIL' end || ' the second sale goes through, stock is -2 and exact (' || stock || '/' || summed || ')');
  res := public.stock_warnings(inv2);
  r := r || (case when res -> 0 ->> 'name' = 'Floor tile' and (res -> 0 ->> 'stock_qty')::numeric = -2 then 'PASS' else 'FAIL' end || ' and it is flagged (' || res::text || ')');
  reset role;

  -- purchase orders: numbered, editable while draft, received once
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.purchase_orders (workspace_id, supplier_id, notes) values (ws, sup, 'Restock') returning id into po;
  select number into t from public.purchase_orders where id = po;
  r := r || (case when t = 'PO-0001' then 'PASS' else 'FAIL' end || ' the first purchase order is PO-0001 (' || t || ')');
  insert into public.purchase_orders (workspace_id, supplier_id) values (ws, sup) returning id into po2;
  select number into t from public.purchase_orders where id = po2;
  r := r || (case when t = 'PO-0002' then 'PASS' else 'FAIL' end || ' the next is PO-0002 (' || t || ')');
  begin
    perform public.receive_purchase_order(po, false);
    r := r || 'FAIL an empty order was received'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS an order with no lines cannot be received'::text;
  end;
  insert into public.purchase_order_lines (workspace_id, po_id, product_id, quantity, unit_cost_cents) values (ws, po, prod, 20, 6500);
  perform public.set_purchase_order_status(po, 'sent');
  begin
    insert into public.purchase_order_lines (workspace_id, po_id, product_id, quantity, unit_cost_cents) values (ws, po, prod2, 1, 100);
    r := r || 'FAIL a sent order was edited'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a sent order cannot be edited'::text;
  end;
  res := public.receive_purchase_order(po, true);
  perform public.receive_purchase_order(po, true);
  select stock_qty into stock from public.products where id = prod;
  r := r || (case when stock = 18 then 'PASS' else 'FAIL' end || ' receiving adds the stock once (-2 + 20 = ' || stock || ')');
  select cost_cents::text into t from public.products where id = prod;
  r := r || (case when t = '6500' then 'PASS' else 'FAIL' end || ' and updates the cost when asked (' || t || ')');
  select count(*) into n from public.stock_movements where product_id = prod and reason = 'purchase';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' one purchase movement (' || n || ')');
  begin
    perform public.set_purchase_order_status(po, 'cancelled');
    r := r || 'FAIL a received order was cancelled'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a received order cannot be cancelled'::text;
  end;
  perform public.set_purchase_order_status(po2, 'cancelled');
  begin
    perform public.receive_purchase_order(po2, false);
    r := r || 'FAIL a cancelled order was received'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a cancelled order cannot be received'::text;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.receive_purchase_order(po, false);
    r := r || 'FAIL the accountant received an order'::text;
  exception when no_data_found then r := r || 'PASS the accountant cannot receive orders'::text;
  end;
  select count(*) into n from public.purchase_orders where workspace_id = ws;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' but can read them (' || n || ')');
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'INVENTORY TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
