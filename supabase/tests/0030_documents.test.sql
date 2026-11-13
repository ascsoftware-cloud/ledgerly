-- Tests for 0030_documents: folders and files, contracts and e-signatures, and the customer portal.
-- Ends by raising "DOCUMENT TESTS: n passed, m failed" (rolls back).

-- Runs one statement as a role. Returns the rows it touched, or -1 if it was refused.
create function pg_temp.probe(who text, uid uuid, q text) returns int language plpgsql as $f$
declare n int;
begin
  perform set_config('request.jwt.claims', case when uid is null then json_build_object('role', who)::text
                                                else json_build_object('sub', uid, 'role', who)::text end, true);
  execute format('set local role %I', who);
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

do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb; j jsonb;
  olga uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws2 uuid; thandi uuid; bongani uuid; no_email uuid; folder uuid; tpl uuid; k1 uuid; k2 uuid; k3 uuid; k_other uuid; k_draft uuid;
  inv uuid; inv_void uuid; inv_draft uuid; inv_other uuid; tok text; tok_old text; tok_b text; hash text;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@doc.test'), (sam, 'sam@doc.test'), (acc, 'acc@doc.test'), (eve, 'eve@doc.test');
  insert into public.workspaces (slug, name, created_by, plan) values ('doc-test-a', 'Olga Plumbing', olga, 'pro') returning id into ws;
  insert into public.workspaces (slug, name, created_by, plan) values ('doc-test-b', 'Eve Co', eve, 'pro') returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values
    (ws, olga, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id, business_name) values (ws, 'Olga Plumbing'), (ws2, 'Eve Co');
  insert into public.contacts (workspace_id, name, email, phone) values (ws, 'Thandi Mokoena', 'thandi@client.test', '+27821234567') returning id into thandi;
  insert into public.contacts (workspace_id, name, email) values (ws, 'Bongani Dlamini', 'bongani@client.test') returning id into bongani;
  insert into public.contacts (workspace_id, name) values (ws, 'No Email') returning id into no_email;

  -- ------------------------------------------------------ folders and files
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.folders (workspace_id, name) values (ws, 'Contracts') returning id into folder;
  r := r || 'PASS staff create folders'::text;
  begin
    insert into public.folders (workspace_id, name) values (ws, 'contracts');
    r := r || 'FAIL a folder name repeated'::text;
  exception when unique_violation then r := r || 'PASS folder names are unique ignoring case'::text;
  end;
  insert into public.files (workspace_id, folder_id, name, storage_path, mime_type, size_bytes)
  values (ws, folder, 'Lease.pdf', ws || '/' || gen_random_uuid() || '/a.pdf', 'application/pdf', 2048);
  r := r || 'PASS staff add a file record'::text;
  begin
    insert into public.files (workspace_id, name, storage_path, mime_type, size_bytes)
    values (ws, 'Sneaky.pdf', ws2 || '/' || gen_random_uuid() || '/a.pdf', 'application/pdf', 10);
    r := r || 'FAIL a file pointed at another workspace folder'::text;
  exception when check_violation then r := r || 'PASS a file path must start with its own workspace'::text;
  end;
  begin
    insert into public.files (workspace_id, name, storage_path, mime_type, size_bytes)
    values (ws, 'Huge.pdf', ws || '/' || gen_random_uuid() || '/a.pdf', 'application/pdf', 10485761);
    r := r || 'FAIL a file over 10 MB'::text;
  exception when check_violation then r := r || 'PASS files over 10 MB are refused'::text;
  end;
  reset role;
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$insert into public.folders (workspace_id, name) values ('%s', 'X')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' the accountant cannot add folders');
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$select 1 from public.files where workspace_id = '%s'$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' but can see files');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select 1 from public.files where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' another business sees no files');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select 1 from public.folders where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' nor folders');

  -- ------------------------------------------------------ contract templates
  insert into public.contract_templates (workspace_id, name, body)
  values (ws, 'Service agreement', 'Agreement between {{business_name}} and {{client_name}}.') returning id into tpl;
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$insert into public.contract_templates (workspace_id, name, body) values ('%s', 'T2', 'Body')$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' staff write templates');
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$insert into public.contract_templates (workspace_id, name, body) values ('%s', 'T3', 'Body')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' the accountant does not');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select 1 from public.contract_templates where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' another business sees no templates');

  -- ------------------------------------------------------------- contracts
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.contracts (workspace_id, contact_id, template_id, title, body)
  values (ws, thandi, tpl, 'Service agreement', 'Agreement between Olga Plumbing and Thandi Mokoena.') returning id into k1;
  insert into public.contracts (workspace_id, contact_id, title, body) values (ws, bongani, 'Other client', 'For Bongani only.') returning id into k_other;
  insert into public.contracts (workspace_id, contact_id, title, body) values (ws, thandi, 'Draft only', 'Not sent yet.') returning id into k_draft;
  update public.contracts set body = 'Agreement between Olga Plumbing and Thandi Mokoena, version 2.' where id = k1;
  r := r || 'PASS staff draft and edit contracts'::text;
  begin
    update public.contracts set status = 'signed' where id = k1;
    r := r || 'FAIL status edited by hand'::text;
  exception when insufficient_privilege then r := r || 'PASS status cannot be edited by hand'::text;
  end;
  res := public.send_contract(k1);
  tok := res ->> 'portal_token';
  reset role;
  r := r || (case when res ->> 'status' = 'sent' and tok ~ '^[A-Za-z0-9_-]{32}$' then 'PASS' else 'FAIL' end || ' sending makes a portal link for the client (' || coalesce(tok, 'none') || ')');
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.send_contract(k1);
  reset role;
  r := r || (case when res ->> 'portal_token' = tok then 'PASS' else 'FAIL' end || ' sending twice keeps one link');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$update public.contracts set body = 'sneaky change' where id = '%s'$q$, k1)) = -1 then 'PASS' else 'FAIL' end || ' a sent contract cannot be edited');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$delete from public.contracts where id = '%s'$q$, k1)) = 0 then 'PASS' else 'FAIL' end || ' or deleted');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$delete from public.contracts where id = '%s'$q$, k_draft)) = 1 then 'PASS' else 'FAIL' end || ' but a draft can be deleted');
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$select public.send_contract('%s')$q$, k_other)) = -1 then 'PASS' else 'FAIL' end || ' the accountant cannot send a contract');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select public.send_contract('%s')$q$, k_other)) = -1 then 'PASS' else 'FAIL' end || ' another business cannot either');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select 1 from public.contracts where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' another business sees no contracts');
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.send_contract(k_other);
  reset role;
  r := r || (case when exists (select 1 from public.audit_log where workspace_id = ws and action = 'contract.sent') then 'PASS' else 'FAIL' end || ' sending is in the activity log');

  -- --------------------------------------------------------------- the portal
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'invoice', thandi) returning id into inv;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, inv, 1, 'Geyser', 1, 100000, 0);
  update public.sales_documents set status = 'sent', number = 'INV-0001', due_date = current_date + 14 where id = inv;
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'quote', thandi);
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'invoice', thandi) returning id into inv_void;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, inv_void, 1, 'Void one', 1, 5000, 0);
  update public.sales_documents set status = 'void', number = 'INV-0002' where id = inv_void;
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'invoice', thandi) returning id into inv_draft;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, inv_draft, 1, 'Draft one', 1, 7000, 0);
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'invoice', bongani) returning id into inv_other;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, inv_other, 1, 'Bongani''s job', 1, 9000, 0);
  update public.sales_documents set status = 'sent', number = 'INV-0003' where id = inv_other;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  j := public.get_portal(tok);
  reset role;
  r := r || (case when j ->> 'business' = 'Olga Plumbing' and j ->> 'client' = 'Thandi Mokoena' then 'PASS' else 'FAIL' end || ' the portal names the business and the client');
  select string_agg(x ->> 'number', ',' order by x ->> 'number') into t from jsonb_array_elements(j -> 'documents') x where x ->> 'number' is not null;
  r := r || (case when t = 'INV-0001' then 'PASS' else 'FAIL' end || ' it lists only this client''s sent documents, not drafts, void or others'' (' || coalesce(t, 'none') || ')');
  r := r || (case when jsonb_array_length(j -> 'documents') = 1 then 'PASS' else 'FAIL' end || ' only the sent invoice is listed, not the draft quote (' || jsonb_array_length(j -> 'documents') || ')');
  select (x ->> 'balance_cents') into t from jsonb_array_elements(j -> 'documents') x where x ->> 'number' = 'INV-0001';
  r := r || (case when t = '100000' then 'PASS' else 'FAIL' end || ' with what is still owed (' || coalesce(t, 'none') || ')');
  select (x ->> 'token') into t from jsonb_array_elements(j -> 'documents') x where x ->> 'number' = 'INV-0001';
  r := r || (case when t = (select public_token from public.sales_documents where id = inv) then 'PASS' else 'FAIL' end || ' and the link the client already uses to pay');
  r := r || (case when jsonb_array_length(j -> 'contracts') = 1 and (j -> 'contracts' -> 0 ->> 'title') = 'Service agreement' then 'PASS' else 'FAIL' end || ' sent contracts only (not the draft, not another client''s)');
  r := r || (case when j::text not like '%thandi@client.test%' and j::text not like '%27821234567%' and j::text not like '%' || ws::text || '%' then 'PASS' else 'FAIL' end || ' no email, phone or internal ids leak');
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  r := r || (case when public.get_portal('short') is null and public.get_portal(repeat('a', 32)) is null then 'PASS' else 'FAIL' end || ' unknown or malformed tokens show nothing');
  reset role;

  -- a single contract through the portal
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  j := public.get_portal_contract(tok, k1);
  reset role;
  r := r || (case when j ->> 'title' = 'Service agreement' and j ->> 'status' = 'sent' and (j ->> 'body') like '%version 2%' then 'PASS' else 'FAIL' end || ' the contract text is shown to its own client');
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  r := r || (case when public.get_portal_contract(tok, k_other) is null then 'PASS' else 'FAIL' end || ' but not another client''s contract');
  r := r || (case when public.get_portal_contract(tok, k_draft) is null then 'PASS' else 'FAIL' end || ' nor a draft');
  reset role;

  -- signing is for the server only, and records the proof
  hash := encode(sha256(convert_to('Service agreement' || E'\n' || 'Agreement between Olga Plumbing and Thandi Mokoena, version 2.', 'utf8')), 'hex');
  r := r || (case when pg_temp.probe('anon', null, format($q$select public.sign_contract('%s','%s','Thandi Mokoena',null,'1.2.3.4','ua')$q$, tok, k1)) = -1 then 'PASS' else 'FAIL' end || ' the public key cannot sign');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$select public.sign_contract('%s','%s','Thandi Mokoena',null,'1.2.3.4','ua')$q$, tok, k1)) = -1 then 'PASS' else 'FAIL' end || ' nor can a signed-in user');
  r := r || (case when pg_temp.probe('postgres', null, format($q$select public.sign_contract('%s','%s','T',null,'1.2.3.4','ua')$q$, tok, k1)) = -1 then 'PASS' else 'FAIL' end || ' a one-letter name is refused');
  r := r || (case when pg_temp.probe('postgres', null, format($q$select public.sign_contract('%s','%s','Thandi Mokoena','not-an-image','1.2.3.4','ua')$q$, tok, k1)) = -1 then 'PASS' else 'FAIL' end || ' so is a signature that is not a PNG');
  r := r || (case when pg_temp.probe('postgres', null, format($q$select public.sign_contract('%s','%s','Thandi Mokoena',null,'1.2.3.4','ua')$q$, tok, k_other)) = -1 then 'PASS' else 'FAIL' end || ' a client cannot sign another client''s contract');
  r := r || (case when pg_temp.probe('postgres', null, format($q$select public.sign_contract('%s','%s','Thandi Mokoena',null,'1.2.3.4','ua')$q$, tok, k_draft)) = -1 then 'PASS' else 'FAIL' end || ' or one that was never sent');
  r := r || (case when pg_temp.probe('postgres', null, format($q$select public.sign_contract('%s','%s','Thandi Mokoena',null,'1.2.3.4','ua')$q$, repeat('b', 32), k1)) = -1 then 'PASS' else 'FAIL' end || ' a made-up token signs nothing');
  res := public.sign_contract(tok, k1, 'Thandi Mokoena', 'data:image/png;base64,iVBORw0KGgo=', '41.1.2.3', 'Mozilla/5.0');
  r := r || (case when res ->> 'hash' = hash then 'PASS' else 'FAIL' end || ' signing returns the SHA-256 of the contract as shown (' || coalesce(res ->> 'hash', 'none') || ')');
  select count(*) into n from public.contract_signatures where contract_id = k1 and signer_name = 'Thandi Mokoena' and ip_address = '41.1.2.3' and user_agent = 'Mozilla/5.0'
    and document_hash = hash and signature_image is not null and signed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the name, time, IP, device and drawn signature are stored');
  r := r || (case when (select status from public.contracts where id = k1) = 'signed' then 'PASS' else 'FAIL' end || ' the contract is signed');
  r := r || (case when pg_temp.probe('postgres', null, format($q$select public.sign_contract('%s','%s','Thandi Mokoena',null,'1.2.3.4','ua')$q$, tok, k1)) = -1 then 'PASS' else 'FAIL' end || ' it cannot be signed twice');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$update public.contract_signatures set signer_name = 'Someone Else' where contract_id = '%s'$q$, k1)) = -1 then 'PASS' else 'FAIL' end || ' the signature record cannot be edited');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$delete from public.contract_signatures where contract_id = '%s'$q$, k1)) = -1 then 'PASS' else 'FAIL' end || ' or deleted');
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$select 1 from public.contract_signatures where contract_id = '%s'$q$, k1)) = 1 then 'PASS' else 'FAIL' end || ' members can read it');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select 1 from public.contract_signatures where contract_id = '%s'$q$, k1)) = 0 then 'PASS' else 'FAIL' end || ' another business cannot');
  r := r || (case when exists (select 1 from public.audit_log where workspace_id = ws and action = 'contract.signed') then 'PASS' else 'FAIL' end || ' the signing is in the activity log');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$select public.void_contract('%s')$q$, k1)) = -1 then 'PASS' else 'FAIL' end || ' a signed contract cannot be voided');
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  j := public.get_portal(tok);
  reset role;
  r := r || (case when (j -> 'contracts' -> 0 ->> 'status') = 'signed' then 'PASS' else 'FAIL' end || ' the portal now shows it as signed');

  -- voiding an unsigned contract hides it from the portal
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.void_contract(k_other);
  reset role;
  r := r || (case when (select status from public.contracts where id = k_other) = 'void' then 'PASS' else 'FAIL' end || ' an unsigned contract can be voided');

  -- ----------------------------------------------------- revoking and rotating
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$select public.revoke_portal_link('%s')$q$, thandi)) = -1 then 'PASS' else 'FAIL' end || ' the accountant cannot revoke links');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select public.revoke_portal_link('%s')$q$, thandi)) = -1 then 'PASS' else 'FAIL' end || ' another business cannot');
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$select token from public.portal_links where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' the accountant cannot read link tokens');
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  tok_old := tok;
  tok := public.rotate_portal_link(thandi);
  reset role;
  r := r || (case when tok <> tok_old and tok ~ '^[A-Za-z0-9_-]{32}$' then 'PASS' else 'FAIL' end || ' a new link replaces the old one');
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  r := r || (case when public.get_portal(tok_old) is null then 'PASS' else 'FAIL' end || ' the old token is now a 404');
  r := r || (case when public.get_portal(tok) is not null then 'PASS' else 'FAIL' end || ' the new token works');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.revoke_portal_link(thandi);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  r := r || (case when public.get_portal(tok) is null then 'PASS' else 'FAIL' end || ' a revoked token is a 404');
  reset role;
  r := r || (case when pg_temp.probe('postgres', null, format($q$select public.sign_contract('%s','%s','Thandi Mokoena',null,'1.2.3.4','ua')$q$, tok, k1)) = -1 then 'PASS' else 'FAIL' end || ' and signs nothing');
  select count(*) into n from public.portal_links where contact_id = thandi and revoked_at is null;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' no active link is left');

  -- ------------------------------------------------------ emailing the link
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select public.queue_portal_email('%s', null, gen_random_uuid())$q$, no_email)) = -1 then 'PASS' else 'FAIL' end || ' a client with no email cannot be emailed');
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$select public.queue_portal_email('%s', null, gen_random_uuid())$q$, thandi)) = -1 then 'PASS' else 'FAIL' end || ' the accountant cannot email links');
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.queue_portal_email(thandi, 'Here are your documents', '22222222-2222-2222-2222-222222222222');
  perform public.queue_portal_email(thandi, 'Here are your documents', '22222222-2222-2222-2222-222222222222');
  reset role;
  select count(*) into n from public.outbox where workspace_id = ws and template = 'portal_link' and to_address = 'thandi@client.test';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the same request queues one email, lower-cased (' || n || ')');
  select count(*) into n from public.portal_links where contact_id = thandi and revoked_at is null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and makes sure there is a link');
  for n in 1..4 loop
    perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.queue_portal_email(thandi, null, gen_random_uuid());
    reset role;
  end loop;
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select public.queue_portal_email('%s', null, gen_random_uuid())$q$, thandi)) = -1 then 'PASS' else 'FAIL' end || ' a sixth email to one client in a day is refused');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'DOCUMENT TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
