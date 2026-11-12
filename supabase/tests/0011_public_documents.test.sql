-- Tests for 0011_public_documents. Ends by raising "PUBLIC DOC TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb;
  alice uuid := gen_random_uuid();
  ws uuid; c uuid; inv uuid; quo uuid; old_quo uuid; draft uuid;
  inv_token text; quo_token text; old_token text; draft_token text;
  line jsonb := '[{"description":"Tiling","quantity":2,"unit_cents":50000,"vat_rate":0}]';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@public.test');
  insert into public.workspaces (slug, name, created_by) values ('public-test-a', 'Alice Tiling', alice) returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner');
  insert into public.workspace_settings (workspace_id, bank_details) values (ws, '{"bank":"FNB","account":"62000000000"}');
  insert into public.contacts (workspace_id, name, email, phone) values (ws, 'Thandi', 'thandi@x.test', '+27821234567') returning id into c;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  quo := public.save_document_draft(ws, null, jsonb_build_object('kind', 'quote', 'contact_id', c), line);
  old_quo := public.save_document_draft(ws, null, jsonb_build_object('kind', 'quote', 'contact_id', c), line);
  draft := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c), line);
  perform public.send_document(inv);
  perform public.send_document(quo);
  perform public.send_document(old_quo);
  reset role;
  update public.sales_documents set due_date = (now() at time zone 'Africa/Johannesburg')::date - 1 where id = old_quo;
  select public_token into inv_token from public.sales_documents where id = inv;
  select public_token into quo_token from public.sales_documents where id = quo;
  select public_token into old_token from public.sales_documents where id = old_quo;
  select public_token into draft_token from public.sales_documents where id = draft;

  r := r || (case when inv_token ~ '^[A-Za-z0-9_-]{32}$' then 'PASS' else 'FAIL' end || ' link tokens are 32 URL-safe characters');

  -- ------------------------------------------------------------ a stranger with the link
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;

  res := public.get_public_document(inv_token);
  r := r || (case when res ->> 'number' = 'INV-0001' and (res -> 'lines' -> 0 ->> 'description') = 'Tiling' then 'PASS' else 'FAIL' end
             || ' the link shows the invoice and its lines');
  r := r || (case when res -> 'business' ->> 'name' = 'Alice Tiling' and res -> 'business' -> 'bank_details' ->> 'bank' = 'FNB' then 'PASS' else 'FAIL' end
             || ' invoices show the business and EFT details');
  r := r || (case when not (res ? 'workspace_id') and not (res ? 'public_token') and not (res ? 'contact_id')
                  and not (res -> 'client' ? 'email') and not (res -> 'client' ? 'phone') then 'PASS' else 'FAIL' end
             || ' no internal ids, token or client contact details leak');
  res := public.get_public_document(quo_token);
  r := r || (case when res -> 'business' -> 'bank_details' = 'null'::jsonb then 'PASS' else 'FAIL' end || ' quotes do not show bank details');

  r := r || (case when public.get_public_document(draft_token) is null then 'PASS' else 'FAIL' end || ' drafts are never public');
  r := r || (case when public.get_public_document('x' || substr(inv_token, 2)) is null then 'PASS' else 'FAIL' end || ' a wrong token shows nothing');
  r := r || (case when public.get_public_document('''; drop table x; --') is null then 'PASS' else 'FAIL' end || ' junk input shows nothing');

  perform public.mark_document_viewed(inv_token);
  perform public.mark_document_viewed(inv_token);
  reset role;
  select count(*) into n from public.sales_documents where id = inv and status = 'viewed' and viewed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' opening the link marks it viewed');
  select count(*) into n from public.activities where ref_id = inv and kind = 'invoice_viewed';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the business hears about the first open only');
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;

  begin
    perform public.accept_quote(inv_token, 'Thandi Mokoena', '1.2.3.4', 'test');
    r := r || 'FAIL an invoice cannot be "accepted"'::text;
  exception when no_data_found then r := r || 'PASS an invoice cannot be "accepted"'::text;
  end;
  begin
    perform public.accept_quote(quo_token, ' T ', '1.2.3.4', 'test');
    r := r || 'FAIL accepting needs a real name'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS accepting needs a real name'::text;
  end;
  begin
    perform public.accept_quote(old_token, 'Thandi Mokoena', '1.2.3.4', 'test');
    r := r || 'FAIL an expired quote cannot be accepted'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS an expired quote cannot be accepted'::text;
  end;

  res := public.accept_quote(quo_token, 'Thandi Mokoena', '1.2.3.4', 'Mozilla/5.0');
  r := r || (case when not (res ->> 'already')::boolean and res ->> 'signer_name' = 'Thandi Mokoena' then 'PASS' else 'FAIL' end || ' a client can accept a quote');
  res := public.accept_quote(quo_token, 'Someone Else', '5.6.7.8', 'x');
  r := r || (case when (res ->> 'already')::boolean and res ->> 'signer_name' = 'Thandi Mokoena' then 'PASS' else 'FAIL' end || ' accepting twice keeps the first signature');
  begin
    perform count(*) from public.signatures;
    r := r || 'FAIL strangers cannot read signatures'::text;
  exception when insufficient_privilege then r := r || 'PASS strangers cannot read signatures'::text;
  end;
  begin
    perform count(*) from public.sales_documents;
    r := r || 'FAIL strangers cannot read the documents table'::text;
  exception when insufficient_privilege then r := r || 'PASS strangers cannot read the documents table'::text;
  end;
  reset role;

  select count(*) into n from public.signatures where document_id = quo and document_hash ~ '^[0-9a-f]{64}$' and ip_address = '1.2.3.4';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the signature records a hash of what was accepted, and the IP');
  select status into t from public.sales_documents where id = quo;
  r := r || (case when t = 'accepted' then 'PASS' else 'FAIL' end || ' the quote is marked accepted');
  select count(*) into n from public.activities where ref_id = quo and kind = 'quote_accepted' and summary like '%accepted by Thandi Mokoena';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the business sees who accepted');

  update public.workspaces set deleted_at = now() where id = ws;
  set local role anon;
  r := r || (case when public.get_public_document(inv_token) is null then 'PASS' else 'FAIL' end || ' links stop working when the workspace is deleted');
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'PUBLIC DOC TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
