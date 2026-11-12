-- Test for 0016. Raises "PURGE TEST: 0 secret(s) left ..." when correct (rolls back).
do $$
declare
  alice uuid := gen_random_uuid(); ws uuid; conn uuid; sid uuid; n int;
begin
  insert into auth.users (id, email) values (alice, 'alice@purge.test');
  insert into public.workspaces (slug, name, created_by) values ('purge-test-a', 'A', alice) returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner');
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  conn := public.connect_payment_provider(ws, 'yoco', 'test', null, 'sk_test_purgepurgepurge', null);
  reset role;
  select secret_id into sid from public.payment_connections where id = conn;
  delete from public.workspaces where id = ws;
  select count(*) into n from vault.secrets where id = sid;
  raise exception 'PURGE TEST: % secret(s) left after deleting the workspace (want 0)', n;
end;
$$;
