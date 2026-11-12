-- Tests for 0050–0055 (integrations, Stitch, shipments, Shopify cache, accounting queue).
-- Ends by raising "INTEGRATIONS TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; ok boolean; res jsonb; j record;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws uuid; ws_b uuid; c uuid; c_b uuid; inv uuid; quo uuid; inv_b uuid;
  cg uuid; cg2 uuid; xero uuid; shop uuid; shop_b uuid; stitch uuid; co uuid; old_sec uuid; job uuid; job2 uuid;
  ship1 uuid; ship2 uuid; req uuid := gen_random_uuid();
  addr_a jsonb := '{"street_address":"1 Main Rd","city":"Pretoria","code":"0182","country":"ZA"}';
  addr_b jsonb := '{"street_address":"9 Long St","city":"Cape Town","code":"8001","country":"ZA"}';
  who jsonb := '{"name":"Thandi","email":"thandi@example.co.za"}';
  parcel jsonb := '[{"submitted_length_cm":20,"submitted_width_cm":20,"submitted_height_cm":10,"submitted_weight_kg":1}]';
  line jsonb := '[{"description":"Work","quantity":1,"unit_cents":100000,"vat_rate":15}]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@int.test'), (sam, 'sam@int.test'), (acc, 'acc@int.test'), (bob, 'bob@int.test');
  insert into public.workspaces (slug, name, created_by) values ('int-test-a', 'A', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('int-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws_b, bob, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws_b);
  insert into public.quest_steps (workspace_id, key, position) values (ws, 'get_paid_setup', 1);
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;
  insert into public.contacts (workspace_id, name) values (ws_b, 'Bea') returning id into c_b;

  -- ------------------------------------------------------------ connecting
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.connect_integration(ws, 'courier_guy', 'test', null, null, '{}', 'key-staff', null, null);
    r := r || 'FAIL staff cannot connect apps'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot connect apps'::text;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cg := public.connect_integration(ws, 'courier_guy', 'test', null, null, '{"base_url":"https://api.shiplogic.com"}', 'key-one', null, null);
  cg2 := public.connect_integration(ws, 'courier_guy', 'test', null, null, '{"base_url":"https://api.shiplogic.com"}', 'key-two', null, null);
  select count(*) into n from public.integration_connections where workspace_id = ws and provider = 'courier_guy' and status = 'active';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' reconnecting replaces the old connection');
  begin
    perform secret_id from public.integration_connections where id = cg2;
    r := r || 'FAIL Vault ids are not readable from the app'::text;
  exception when insufficient_privilege then r := r || 'PASS Vault ids are not readable from the app'::text;
  end;
  begin
    perform * from public.integration_secrets(cg2);
    r := r || 'FAIL users cannot read decrypted credentials'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot read decrypted credentials'::text;
  end;
  begin
    perform public.enqueue_integration_job(cg2, 'track_shipment', null, '{}', 'fake-job-from-user', 0);
    r := r || 'FAIL users cannot add jobs directly'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot add jobs directly'::text;
  end;
  begin
    perform public.connect_integration(ws, 'shopify', 'live', 'thandis-store.myshopify.com', null, '{}', 'shpat_x', 'r', 3600);
    r := r || 'FAIL a Shopify store can only be claimed through Shopify''s OAuth'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a Shopify store can only be claimed through Shopify''s OAuth'::text;
  end;
  begin
    perform public.connect_shopify(ws, alice, 'thandis-store.myshopify.com', null, '{}', 'shpat_x', 'r', 3600);
    r := r || 'FAIL users cannot call the server-only Shopify connect'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot call the server-only Shopify connect'::text;
  end;
  xero := public.connect_integration(ws, 'xero', 'live', 'tenant-1', 'Thandi Co', '{}', 'access', 'refresh', 1800);
  perform public.update_integration_settings(xero, '{"sales_account":"200","_secret_flag":"x"}');
  select settings ->> 'sales_account', settings ? '_secret_flag' into t, ok from public.integration_connections where id = xero;
  r := r || (case when t = '200' and not ok then 'PASS' else 'FAIL' end || ' settings save, reserved "_" keys cannot be set by users');
  reset role;

  -- The server, after a verified Shopify OAuth callback:
  begin
    perform public.connect_shopify(ws, sam, 'thandis-store.myshopify.com', null, '{}', 'shpat_a', null, null);
    r := r || 'FAIL staff cannot connect a store even through the server'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot connect a store even through the server'::text;
  end;
  begin
    perform public.connect_shopify(ws, alice, 'evil.example.com', null, '{}', 'shpat_x', 'r', 3600);
    r := r || 'FAIL a non-myshopify domain is refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a non-myshopify domain is refused'::text;
  end;
  shop := public.connect_shopify(ws, alice, 'Thandis-Store.myshopify.com', 'Thandi''s Store', '{}', 'shpat_a', 'shprt_a', 3600);
  select external_id into t from public.integration_connections where id = shop;
  r := r || (case when t = 'thandis-store.myshopify.com' then 'PASS' else 'FAIL' end || ' shop domains are stored in lower case');
  begin
    perform public.connect_shopify(ws_b, bob, 'thandis-store.myshopify.com', null, '{}', 'shpat_b', null, null);
    r := r || 'FAIL one Shopify store cannot be connected to two workspaces'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS one Shopify store cannot be connected to two workspaces'::text;
  end;

  select secret_id into old_sec from public.integration_connections where id = cg;
  select count(*) into n from vault.secrets where id = old_sec;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a replaced connection''s credential is deleted from Vault');
  select secret into t from public.integration_secrets(cg2);
  r := r || (case when t = 'key-two' then 'PASS' else 'FAIL' end || ' the server reads the current credential');

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.integration_connections where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s apps');
  begin
    perform public.disconnect_integration(cg2);
    r := r || 'FAIL another workspace cannot disconnect A''s app'::text;
  exception when no_data_found then r := r || 'PASS another workspace cannot disconnect A''s app'::text;
  end;
  reset role;

  -- ------------------------------------------------------------ token refresh lease
  ok := public.claim_token_refresh(xero);
  r := r || (case when ok then 'PASS' else 'FAIL' end || ' the first worker gets the refresh lease');
  ok := public.claim_token_refresh(xero);
  r := r || (case when not ok then 'PASS' else 'FAIL' end || ' a second worker does not, while the lease runs');
  perform public.store_integration_tokens(xero, 'access-2', 'refresh-2', 1800);
  select secret || '/' || refresh into t from public.integration_secrets(xero);
  r := r || (case when t = 'access-2/refresh-2' then 'PASS' else 'FAIL' end || ' rotated tokens are saved (' || coalesce(t, 'null') || ')');
  ok := public.claim_token_refresh(xero);
  r := r || (case when ok then 'PASS' else 'FAIL' end || ' saving tokens releases the lease');
  perform public.mark_integration(xero, 'active', null, false);

  -- ------------------------------------------------------------ queue
  job := public.enqueue_integration_job(cg2, 'track_shipment', null, '{}', 'test:queue:1', 0);
  job2 := public.enqueue_integration_job(cg2, 'track_shipment', null, '{}', 'test:queue:1', 0);
  r := r || (case when job = job2 then 'PASS' else 'FAIL' end || ' the same intent queued twice is one job');
  select count(*) into n from public.claim_integration_jobs(25) where id = job;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a due job is claimed');
  select count(*) into n from public.claim_integration_jobs(25) where id = job;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a claimed job is not claimed twice');
  perform public.finish_integration_job(job, false, 'boom', null);
  select status, attempts, next_attempt_at > now() + interval '50 seconds' as later into j from public.integration_jobs where id = job;
  r := r || (case when j.status = 'pending' and j.attempts = 1 and j.later then 'PASS' else 'FAIL' end || ' a failure retries later');
  update public.integration_jobs set attempts = 8, status = 'running' where id = job;
  perform public.finish_integration_job(job, false, 'boom', null);
  select status into t from public.integration_jobs where id = job;
  r := r || (case when t = 'failed' then 'PASS' else 'FAIL' end || ' after 8 attempts a job stops');
  update public.integration_jobs set status = 'running' where id = job2;
  update public.integration_jobs set status = 'failed' where id = job;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.retry_integration_job(job);
  reset role;
  select status || '/' || attempts into t from public.integration_jobs where id = job;
  r := r || (case when t = 'pending/0' then 'PASS' else 'FAIL' end || ' "Try again" requeues a failed job (' || t || ')');

  job2 := public.enqueue_integration_job(cg2, 'track_shipment', null, '{}', 'test:queue:stop', 0);
  update public.integration_jobs set status = 'running', attempts = 1 where id = job2;
  perform public.finish_integration_job(job2, false, 'Choose a sales account', 0);
  select status into t from public.integration_jobs where id = job2;
  r := r || (case when t = 'failed' then 'PASS' else 'FAIL' end || ' a problem the person must fix stops the job at once');
  update public.integration_jobs set status = 'running' where id = job;
  perform public.finish_integration_job(job, true, null, 5);
  select status || '/' || attempts into t from public.integration_jobs where id = job;
  r := r || (case when t = 'pending/0' then 'PASS' else 'FAIL' end || ' a batch can continue without counting as a failure');
  update public.integration_jobs set status = 'done' where id = job;

  -- ------------------------------------------------------------ accounting triggers
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  quo := public.save_document_draft(ws, null, jsonb_build_object('kind', 'quote', 'contact_id', c), line);
  perform public.send_document(inv);
  perform public.send_document(quo);
  res := public.record_manual_payment(inv, 50000, 'eft', null, null, null, gen_random_uuid());
  begin
    perform public.queue_accounting_push(inv);
    r := r || 'FAIL staff cannot force a push to accounting'::text;
  exception when no_data_found then r := r || 'PASS staff cannot force a push to accounting'::text;
  end;
  reset role;
  select count(*) into n from public.integration_jobs where connection_id = xero and kind = 'push_document' and entity_id = inv;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' sending an invoice queues one push to Xero');
  select count(*) into n from public.integration_jobs where connection_id = xero and entity_id = quo;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' quotes are not pushed');
  select count(*) into n from public.integration_jobs where connection_id = xero and kind = 'push_payment';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a payment queues one push');
  select count(*) into n from public.integration_jobs where connection_id = cg2 and kind = 'push_document';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' non-accounting apps get no pushes');

  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.queue_accounting_push(inv);
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' an accountant can resend a document to accounting');
  select count(*) into n from public.integration_jobs where connection_id = xero;
  r := r || (case when n >= 2 then 'PASS' else 'FAIL' end || ' accountants can see accounting jobs');
  reset role;

  -- ------------------------------------------------------------ shipments
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.start_shipment(ws, inv, req, addr_a, addr_b, who, who, parcel, 'ECO', 'Economy', 12000);
  ship1 := (res ->> 'id')::uuid;
  res := public.start_shipment(ws, inv, req, addr_a, addr_b, who, who, parcel, 'ECO', 'Economy', 12000);
  ship2 := (res ->> 'id')::uuid;
  r := r || (case when ship1 = ship2 and not (res ->> 'new')::boolean then 'PASS' else 'FAIL' end || ' booking twice with one request is one shipment');
  begin
    perform public.start_shipment(ws, inv, gen_random_uuid(), addr_a, addr_a, who, who, parcel, 'ECO', null, null);
    r := r || 'FAIL identical addresses are refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS identical addresses are refused'::text;
  end;
  begin
    perform public.start_shipment(ws, quo, gen_random_uuid(), addr_a, addr_b, who, who, parcel, 'ECO', null, null);
    r := r || 'FAIL only invoices can be shipped'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS only invoices can be shipped'::text;
  end;
  begin
    perform public.start_shipment(ws, inv, gen_random_uuid(), addr_a, addr_b, who, '{"name":"No contact"}', parcel, 'ECO', null, null);
    r := r || 'FAIL a recipient needs an email or mobile'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a recipient needs an email or mobile'::text;
  end;
  begin
    insert into public.shipments (workspace_id, connection_id, collection_address, delivery_address, collection_contact,
                                  delivery_contact, parcels, service_level_code, request_id)
    values (ws, cg2, addr_a, addr_b, who, who, parcel, 'ECO', gen_random_uuid());
    r := r || 'FAIL shipments cannot be written directly'::text;
  exception when insufficient_privilege then r := r || 'PASS shipments cannot be written directly'::text;
  end;
  reset role;

  perform public.finish_shipment_booking(ship1, true, 'sl-123', 'TCG000123', 'submitted', 12500, null);
  perform public.record_shipment_tracking(ship1, 'in_transit', 'in-transit',
    '[{"at":"2027-01-05T08:00:00Z","status":"collected","message":"Collected"},{"at":"2027-01-05T08:00:00Z","status":"collected"}]');
  select status || '/' || tracking_ref into t from public.shipments where id = ship1;
  select count(*) into n from public.shipment_events where shipment_id = ship1;
  r := r || (case when t = 'in_transit/TCG000123' and n = 1 then 'PASS' else 'FAIL' end || ' booking and tracking are recorded, events once (' || t || ', ' || n || ')');
  n := public.queue_shipment_tracking();
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' parcels on their way are queued for tracking');

  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_shipment(ws, inv, gen_random_uuid(), addr_a, addr_b, who, who, parcel, 'ECO', null, null);
    r := r || 'FAIL accountants cannot book couriers'::text;
  exception when insufficient_privilege then r := r || 'PASS accountants cannot book couriers'::text;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.shipments;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s shipments');
  begin
    perform public.start_shipment(ws, inv, req, addr_a, addr_b, who, who, parcel, 'ECO', null, null);
    r := r || 'FAIL another workspace cannot reuse A''s booking request'::text;
  exception when insufficient_privilege then r := r || 'PASS another workspace cannot reuse A''s booking request'::text;
  end;
  reset role;

  -- ------------------------------------------------------------ Shopify cache
  insert into public.shopify_products (workspace_id, connection_id, id, title, synced_at)
  values (ws, shop, 'gid://shopify/Product/1', 'Mug', now() - interval '1 day'),
         (ws, shop, 'gid://shopify/Product/2', 'Cap', now());
  insert into public.shopify_orders (workspace_id, connection_id, id, name, shop_created_at, total, currency)
  values (ws, shop, 'gid://shopify/Order/1', '#1001', now(), 250.00, 'ZAR');
  n := public.shopify_prune_products(shop, now() - interval '1 hour');
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' products missing from a full sync are removed');
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.shopify_orders;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s Shopify orders');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.shopify_orders;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' members can see their Shopify orders');
  begin
    delete from public.shopify_orders;
    r := r || 'FAIL members cannot change the Shopify copy'::text;
  exception when insufficient_privilege then r := r || 'PASS members cannot change the Shopify copy'::text;
  end;
  reset role;
  n := public.queue_shopify_syncs();
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' connected stores are queued for a sync');

  ok := public.record_integration_event('shopify', 'wh-1', ws, 'orders/create', 'received');
  ok := ok and not public.record_integration_event('shopify', 'wh-1', ws, 'orders/create', 'received');
  r := r || (case when ok then 'PASS' else 'FAIL' end || ' a webhook delivery is recorded once');

  -- ------------------------------------------------------------ Stitch
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.connect_stitch(ws, 'test', 'test-client-1234', 'short', null);
    r := r || 'FAIL a too-short Stitch secret is refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a too-short Stitch secret is refused'::text;
  end;
  stitch := public.connect_stitch(ws, 'test', 'test-client-1234', 'a-long-enough-secret-value', 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');
  reset role;
  insert into public.payment_checkouts (workspace_id, document_id, connection_id, provider, amount_cents)
  values (ws, inv, stitch, 'stitch', 65000) returning id into co;
  t := public.apply_payment_event(stitch, 'stitch', 'msg_1', co, 65000, 'pr_1', '{}');
  r := r || (case when t = 'applied' then 'PASS' else 'FAIL' end || ' a Stitch payment is applied (' || t || ')');
  t := public.apply_payment_event(stitch, 'stitch', 'return:pr_1', co, 65000, 'pr_1', '{}');
  r := r || (case when t = 'duplicate payment' then 'PASS' else 'FAIL' end || ' the webhook and the return page apply it once (' || t || ')');
  select status into t from public.sales_documents where id = inv;
  r := r || (case when t = 'paid' then 'PASS' else 'FAIL' end || ' the invoice is paid');
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.remove_payment((select id from public.payments where method = 'stitch' and provider_ref = 'pr_1'));
    r := r || 'FAIL a Stitch payment cannot be removed by hand'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS a Stitch payment cannot be removed by hand'::text;
  end;
  reset role;
  select client_secret into t from public.stitch_connection_secrets(stitch);
  r := r || (case when t = 'a-long-enough-secret-value' then 'PASS' else 'FAIL' end || ' the server reads the Stitch secret');

  -- ------------------------------------------------------------ reconnecting the same organisation
  perform public.save_sync_link(xero, 'document', inv, 'xero-inv-1', 'INV-0001', 115000, 115000);
  update public.integration_jobs set status = 'failed' where connection_id = xero and kind = 'push_payment';
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  job := public.connect_integration(ws, 'xero', 'live', 'tenant-1', 'Thandi Co', '{}', 'access-3', 'refresh-3', 1800);
  reset role;
  select count(*) into n from public.sync_links where connection_id = job and local_id = inv and external_id = 'xero-inv-1';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' reconnecting the same Xero organisation keeps what was already sent');
  select count(*) into n from public.integration_jobs where connection_id = job and kind = 'push_payment' and status = 'pending';
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' and moves stuck pushes (both payments) to the new connection (' || n || ')');
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  job2 := public.connect_integration(ws, 'xero', 'live', 'tenant-OTHER', 'Other Co', '{}', 'access-4', 'refresh-4', 1800);
  reset role;
  select count(*) into n from public.sync_links where connection_id = job2;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a different organisation starts clean');
  xero := job2;

  -- ------------------------------------------------------------ disconnect and delete
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.disconnect_integration(xero);
  reset role;
  select count(*) into n from public.integration_jobs where connection_id = xero and status in ('pending', 'running');
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' disconnecting cancels queued jobs');
  select count(*) into n from vault.secrets where description like 'xero%' and description like '%' || ws || '%';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' disconnecting deletes the stored tokens');

  delete from public.workspaces where id = ws;
  select count(*) into n from vault.secrets where description like '%' || ws || '%' and name like 'int:%';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' deleting the workspace deletes its app credentials');

  set local role anon;
  begin
    perform count(*) from public.integration_connections;
    r := r || 'FAIL strangers cannot read connections'::text;
  exception when insufficient_privilege then r := r || 'PASS strangers cannot read connections'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'INTEGRATIONS TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
