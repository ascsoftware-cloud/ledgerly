-- RLS and role tests for 0001_tenancy.
--
-- How it runs: the whole file is one DO block. It builds two workspaces with
-- throwaway users, impersonates each user the same way the API does (role
-- `authenticated` plus JWT claims), records PASS/FAIL per check, and finishes by
-- RAISING an exception that carries the report. Raising rolls everything back,
-- so the database is left untouched whether the checks pass or fail.
--
-- Read the result from the error message: "TENANCY TESTS: n passed, m failed".

do $$
declare
  r text[] := '{}';
  n int;
  alice uuid := gen_random_uuid();   -- owner of workspace A
  adam uuid := gen_random_uuid();    -- admin of A
  sam uuid := gen_random_uuid();     -- staff of A
  acc uuid := gen_random_uuid();     -- accountant of A
  bob uuid := gen_random_uuid();     -- owner of workspace B
  ws_a uuid;
  ws_b uuid;
  m_sam uuid;
  m_alice uuid;
  m_bob uuid;
  passed int;
  failed int;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into auth.users (id, email, raw_user_meta_data) values
    (alice, 'alice@rls.test', '{"full_name":"Alice Owner"}'),
    (adam, 'adam@rls.test', '{"name":"Adam Admin"}'),
    (sam, 'sam@rls.test', '{}'),
    (acc, 'acc@rls.test', '{}'),
    (bob, 'bob@rls.test', '{"full_name":"Bob Other"}');

  insert into public.workspaces (slug, name, created_by) values ('rls-test-a', 'A', alice) returning id into ws_a;
  insert into public.workspaces (slug, name, created_by) values ('rls-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws_a, alice, 'owner') returning id into m_alice;
  insert into public.memberships (workspace_id, user_id, role) values (ws_a, adam, 'admin');
  insert into public.memberships (workspace_id, user_id, role) values (ws_a, sam, 'staff') returning id into m_sam;
  insert into public.memberships (workspace_id, user_id, role) values (ws_a, acc, 'accountant');
  insert into public.memberships (workspace_id, user_id, role) values (ws_b, bob, 'owner') returning id into m_bob;
  insert into public.workspace_settings (workspace_id) values (ws_a), (ws_b);
  insert into public.workspace_modules (workspace_id, module) values (ws_a, 'invoices'), (ws_b, 'invoices');
  insert into public.invites (workspace_id, email, role, token_hash, invited_by)
    values (ws_b, 'guest@rls.test', 'staff', 'hash-b', bob);

  select count(*) into n from public.profiles where id = alice and full_name = 'Alice Owner';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' new account gets a profile with its name');
  select count(*) into n from public.profiles where id = adam and full_name = 'Adam Admin';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' profile falls back to the "name" claim');

  begin
    insert into public.workspaces (slug, name) values ('login', 'Shadow');
    r := r || 'FAIL reserved slug is rejected'::text;
  exception when check_violation then r := r || 'PASS reserved slug is rejected'::text;
  end;

  -- ------------------------------------------------- Alice (owner of A) vs B
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.workspaces;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' owner sees exactly their own workspace (' || n || ')');
  select count(*) into n from public.workspaces where id = ws_b;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read workspace B');
  update public.workspaces set name = 'hacked' where id = ws_b; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot rename workspace B');
  update public.workspaces set name = 'A renamed' where id = ws_a; get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' owner can rename their own workspace');

  begin
    update public.workspaces set plan = 'pro' where id = ws_a;
    r := r || 'FAIL owner cannot upgrade their own plan'::text;
  exception when insufficient_privilege then r := r || 'PASS owner cannot upgrade their own plan'::text;
  end;
  begin
    insert into public.workspaces (slug, name) values ('rls-sneaky', 'Sneaky');
    r := r || 'FAIL workspaces cannot be inserted directly'::text;
  exception when insufficient_privilege then r := r || 'PASS workspaces cannot be inserted directly'::text;
  end;
  begin
    delete from public.workspaces where id = ws_b;
    r := r || 'FAIL workspaces cannot be deleted directly'::text;
  exception when insufficient_privilege then r := r || 'PASS workspaces cannot be deleted directly'::text;
  end;

  select count(*) into n from public.memberships where workspace_id = ws_b;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read B''s members');
  begin
    insert into public.memberships (workspace_id, user_id, role) values (ws_b, alice, 'owner');
    r := r || 'FAIL A cannot add themselves to B'::text;
  exception when insufficient_privilege then r := r || 'PASS A cannot add themselves to B'::text;
  end;
  update public.memberships set role = 'staff' where id = m_bob; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot change roles in B');
  delete from public.memberships where id = m_bob; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot remove members of B');

  select count(*) into n from public.invites;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read B''s invites');
  begin
    insert into public.invites (workspace_id, email, role, token_hash, invited_by)
      values (ws_b, 'mole@rls.test', 'admin', 'hash-mole', alice);
    r := r || 'FAIL A cannot invite people into B'::text;
  exception when insufficient_privilege then r := r || 'PASS A cannot invite people into B'::text;
  end;
  begin
    insert into public.invites (workspace_id, email, role, token_hash, invited_by)
      values (ws_a, 'forged@rls.test', 'staff', 'hash-forged', bob);
    r := r || 'FAIL an invite cannot be attributed to someone else'::text;
  exception when insufficient_privilege then r := r || 'PASS an invite cannot be attributed to someone else'::text;
  end;
  begin
    insert into public.invites (workspace_id, email, role, token_hash, invited_by)
      values (ws_a, 'boss@rls.test', 'owner', 'hash-boss', alice);
    r := r || 'FAIL ownership cannot be given by invite'::text;
  exception when check_violation then r := r || 'PASS ownership cannot be given by invite'::text;
  end;
  insert into public.invites (workspace_id, email, role, token_hash, invited_by)
    values (ws_a, 'new@rls.test', 'staff', 'hash-a', alice);
  select count(*) into n from public.invites where workspace_id = ws_a;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' owner can invite into their own workspace');

  select count(*) into n from public.workspace_modules where workspace_id = ws_b;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read B''s modules');
  update public.workspace_modules set enabled = false where workspace_id = ws_b; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot switch B''s modules');
  begin
    insert into public.workspace_modules (workspace_id, module) values (ws_b, 'bookings');
    r := r || 'FAIL A cannot add modules to B'::text;
  exception when insufficient_privilege then r := r || 'PASS A cannot add modules to B'::text;
  end;

  select count(*) into n from public.workspace_settings where workspace_id = ws_b;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read B''s settings');
  update public.workspace_settings set vat_number = '666' where workspace_id = ws_b; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot change B''s settings');

  select count(*) into n from public.profiles where id = sam;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' teammates can see each other''s profile');
  select count(*) into n from public.profiles where id = bob;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' A cannot read the profile of someone in B');
  update public.profiles set full_name = 'Defaced' where id = sam; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' nobody can edit another person''s profile');

  begin
    update public.memberships set role = 'admin' where id = m_alice;
    r := r || 'FAIL the last owner cannot demote themselves'::text;
  exception when check_violation then r := r || 'PASS the last owner cannot demote themselves'::text;
  end;
  begin
    delete from public.memberships where id = m_alice;
    r := r || 'FAIL the last owner cannot leave'::text;
  exception when check_violation then r := r || 'PASS the last owner cannot leave'::text;
  end;

  -- --------------------------------------------------------------- Sam (staff)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.workspace_settings where workspace_id = ws_a;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' staff can read settings (needed for invoice defaults)');
  update public.workspace_settings set vat_registered = true where workspace_id = ws_a; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' staff cannot change settings');
  update public.workspaces set name = 'Staff was here' where id = ws_a; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' staff cannot rename the workspace');
  update public.workspace_modules set enabled = false where workspace_id = ws_a; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' staff cannot switch modules');
  update public.memberships set role = 'admin' where id = m_sam; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' staff cannot promote themselves');
  select count(*) into n from public.invites;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' staff cannot read invites');
  begin
    insert into public.invites (workspace_id, email, role, token_hash, invited_by)
      values (ws_a, 'pal@rls.test', 'staff', 'hash-pal', sam);
    r := r || 'FAIL staff cannot invite'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot invite'::text;
  end;

  -- --------------------------------------------------------- Acc (accountant)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.workspaces where id = ws_a;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' accountant can read the workspace');
  update public.workspace_settings set vat_number = '123' where workspace_id = ws_a; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' accountant cannot change settings');

  -- -------------------------------------------------------------- Adam (admin)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adam, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.workspace_settings set vat_registered = true, vat_number = '4123456789' where workspace_id = ws_a;
  get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' admin can change settings');
  update public.memberships set role = 'accountant' where id = m_sam; get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' admin can change a staff member''s role');
  begin
    update public.memberships set role = 'owner' where user_id = adam and workspace_id = ws_a;
    r := r || 'FAIL admin cannot make themselves owner'::text;
  exception when insufficient_privilege then r := r || 'PASS admin cannot make themselves owner'::text;
  end;
  begin
    update public.memberships set role = 'staff' where id = m_alice;
    r := r || 'FAIL admin cannot demote the owner'::text;
  exception when insufficient_privilege then r := r || 'PASS admin cannot demote the owner'::text;
  end;
  begin
    delete from public.memberships where id = m_alice;
    r := r || 'FAIL admin cannot remove the owner'::text;
  exception when insufficient_privilege then r := r || 'PASS admin cannot remove the owner'::text;
  end;
  begin
    update public.memberships set workspace_id = ws_b where id = m_sam;
    r := r || 'FAIL a membership cannot be moved to another workspace'::text;
  exception
    when insufficient_privilege then r := r || 'PASS a membership cannot be moved to another workspace'::text;
    when check_violation then r := r || 'PASS a membership cannot be moved to another workspace'::text;
  end;

  -- ------------------------------------------- removal takes effect immediately
  delete from public.memberships where id = m_sam; get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' admin can remove a member');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.workspaces;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a removed member loses access on the next query');
  select count(*) into n from public.workspace_settings;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a removed member cannot read settings');

  -- ------------------------------------------------------- signed-out visitors
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    select count(*) into n from public.workspaces;
    r := r || 'FAIL signed-out visitors cannot query workspaces'::text;
  exception when insufficient_privilege then r := r || 'PASS signed-out visitors cannot query workspaces'::text;
  end;
  begin
    select count(*) into n from public.profiles;
    r := r || 'FAIL signed-out visitors cannot query profiles'::text;
  exception when insufficient_privilege then r := r || 'PASS signed-out visitors cannot query profiles'::text;
  end;
  begin
    perform app.is_member(ws_a);
    r := r || 'FAIL signed-out visitors cannot call the access helpers'::text;
  exception when insufficient_privilege then r := r || 'PASS signed-out visitors cannot call the access helpers'::text;
  end;

  -- ------------------------------------------------------ soft and hard delete
  reset role;
  update public.workspaces set deleted_at = now() where id = ws_b;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.workspaces;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a deleted workspace disappears for its members');

  reset role;
  perform set_config('request.jwt.claims', '', true);
  begin
    delete from public.workspaces where id = ws_b;
    select count(*) into n from public.memberships where workspace_id = ws_b;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' deleting a workspace removes its memberships');
  exception when others then
    r := r || ('FAIL deleting a workspace removes its memberships (' || sqlerrm || ')');
  end;

  -- ------------------------------------------------------------------ report
  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%')
    into passed, failed from unnest(r) as x;
  raise exception E'TENANCY TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
