-- Tests for 0007_crm. Ends by raising "CRM TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int;
  alice uuid := gen_random_uuid();   -- owner of A
  sam uuid := gen_random_uuid();     -- staff of A
  acc uuid := gen_random_uuid();     -- accountant of A
  bob uuid := gen_random_uuid();     -- owner of B
  ws_a uuid; ws_b uuid;
  co_a uuid; co_b uuid;
  c_a uuid; c_b uuid; c_sam uuid;
  tag_b uuid;
  note_sam uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values
    (alice, 'alice@crm.test'), (sam, 'sam@crm.test'), (acc, 'acc@crm.test'), (bob, 'bob@crm.test');
  insert into public.workspaces (slug, name, created_by) values ('crm-test-a', 'A', alice) returning id into ws_a;
  insert into public.workspaces (slug, name, created_by) values ('crm-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values
    (ws_a, alice, 'owner'), (ws_a, sam, 'staff'), (ws_a, acc, 'accountant'), (ws_b, bob, 'owner');
  insert into public.quest_steps (workspace_id, key, position) values (ws_a, 'first_client', 1);
  insert into public.companies (workspace_id, name) values (ws_b, 'B Corp') returning id into co_b;
  insert into public.contacts (workspace_id, company_id, name, email) values (ws_b, co_b, 'Bea', 'bea@b.test') returning id into c_b;
  insert into public.tags (workspace_id, name) values (ws_b, 'VIP') returning id into tag_b;

  -- ------------------------------------------------------------ Alice (owner of A)
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.companies (workspace_id, name, vat_number) values (ws_a, 'Acme Plumbing', '4123456789') returning id into co_a;
  insert into public.contacts (workspace_id, company_id, name, email, phone)
    values (ws_a, co_a, 'Thandi Mokoena', 'thandi@acme.test', '+27821234567') returning id into c_a;
  r := r || (case when c_a is not null then 'PASS' else 'FAIL' end || ' owner can add a client');

  select count(*) into n from public.contacts where id = c_a and created_by = alice;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the creator is stamped from the session');
  select count(*) into n from public.activities where contact_id = c_a and kind = 'contact_created';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' adding a client writes the timeline');
  select count(*) into n from public.quest_steps where workspace_id = ws_a and key = 'first_client' and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' first client ticks the quest step');

  select count(*) into n from public.contacts where search @@ plainto_tsquery('simple', 'thandi');
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' clients are searchable by name');

  select count(*) into n from public.contacts;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' A sees only A''s clients (' || n || ')');
  select count(*) into n from public.companies where id = co_b;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read B''s companies');
  select count(*) into n from public.tags where id = tag_b;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read B''s tags');
  update public.contacts set name = 'Hacked' where id = c_b; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot edit B''s clients');
  delete from public.contacts where id = c_b; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot delete B''s clients');

  begin
    insert into public.contacts (workspace_id, name) values (ws_b, 'Planted');
    r := r || 'FAIL A cannot add clients to B'::text;
  exception when insufficient_privilege then r := r || 'PASS A cannot add clients to B'::text;
  end;
  begin
    insert into public.contacts (workspace_id, company_id, name) values (ws_a, co_b, 'Cross-linked');
    r := r || 'FAIL a client cannot be linked to another workspace''s company'::text;
  exception when foreign_key_violation then r := r || 'PASS a client cannot be linked to another workspace''s company'::text;
  end;
  begin
    insert into public.notes (workspace_id, contact_id, body) values (ws_a, c_b, 'Spying');
    r := r || 'FAIL a note cannot be attached to another workspace''s client'::text;
  exception when foreign_key_violation then r := r || 'PASS a note cannot be attached to another workspace''s client'::text;
  end;
  begin
    insert into public.contact_tags (workspace_id, contact_id, tag_id) values (ws_a, c_a, tag_b);
    r := r || 'FAIL a client cannot be tagged with another workspace''s tag'::text;
  exception when foreign_key_violation then r := r || 'PASS a client cannot be tagged with another workspace''s tag'::text;
  end;
  begin
    update public.contacts set created_by = bob where id = c_a;
    r := r || 'FAIL the creator cannot be rewritten'::text;
  exception when insufficient_privilege then r := r || 'PASS the creator cannot be rewritten'::text;
  end;
  begin
    insert into public.activities (workspace_id, contact_id, kind, summary) values (ws_a, c_a, 'payment_received', 'Fake payment');
    r := r || 'FAIL the timeline cannot be written directly'::text;
  exception when insufficient_privilege then r := r || 'PASS the timeline cannot be written directly'::text;
  end;
  begin
    insert into public.contacts (workspace_id, name, phone) values (ws_a, 'Bad phone', '082 123 4567');
    r := r || 'FAIL phone numbers must be stored in international form'::text;
  exception when check_violation then r := r || 'PASS phone numbers must be stored in international form'::text;
  end;
  begin
    insert into public.companies (workspace_id, name) values (ws_a, 'acme plumbing');
    r := r || 'FAIL company names are unique per workspace (any case)'::text;
  exception when unique_violation then r := r || 'PASS company names are unique per workspace (any case)'::text;
  end;

  -- ------------------------------------------------------------ Sam (staff)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.contacts (workspace_id, name) values (ws_a, 'Sipho Dube') returning id into c_sam;
  r := r || (case when c_sam is not null then 'PASS' else 'FAIL' end || ' staff can add a client');
  insert into public.notes (workspace_id, contact_id, body) values (ws_a, c_a, 'Prefers WhatsApp') returning id into note_sam;
  select count(*) into n from public.notes where id = note_sam and author_id = sam;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' staff can add a note, signed as themselves');
  select count(*) into n from public.activities where contact_id = c_a and kind = 'note_added';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a note appears on the timeline');
  delete from public.contacts where id = c_a; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' staff cannot permanently delete clients');
  update public.contacts set deleted_at = now() where id = c_sam; get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' staff can archive (soft-delete) a client');

  -- ------------------------------------------------------------ Acc (accountant)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.contacts where workspace_id = ws_a;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' accountant can read clients (' || n || ')');
  begin
    insert into public.contacts (workspace_id, name) values (ws_a, 'Accountant add');
    r := r || 'FAIL accountant cannot add clients'::text;
  exception when insufficient_privilege then r := r || 'PASS accountant cannot add clients'::text;
  end;
  update public.contacts set name = 'Changed' where id = c_a; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' accountant cannot edit clients');
  update public.notes set body = 'Edited by accountant' where id = note_sam; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' accountant cannot edit notes');

  -- ------------------------------------------------------------ Alice again: notes belong to their author
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.notes set body = 'Rewritten by owner' where id = note_sam; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' only the author can edit a note');
  delete from public.notes where id = note_sam; get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' an owner can remove any note');
  begin
    update public.contacts set workspace_id = ws_b where id = c_a;
    r := r || 'FAIL a client cannot be moved to another workspace'::text;
  exception when insufficient_privilege or check_violation then
    r := r || 'PASS a client cannot be moved to another workspace'::text;
  end;

  -- ------------------------------------------------------------ signed out
  reset role;
  set local role anon;
  begin
    perform count(*) from public.contacts;
    r := r || 'FAIL signed-out visitors cannot read clients'::text;
  exception when insufficient_privilege then r := r || 'PASS signed-out visitors cannot read clients'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%')
    into passed, failed from unnest(r) as x;
  raise exception E'CRM TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
