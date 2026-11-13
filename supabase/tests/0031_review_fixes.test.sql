-- Tests for 0031_review_fixes. Ends by raising "REVIEW FIX TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  olga uuid := gen_random_uuid(); ws uuid; inv uuid; inv2 uuid; inv3 uuid; n int; t text;
  req uuid := '33333333-3333-3333-3333-333333333333';
  tok1 text := 'first-token-' || md5(random()::text); tok2 text := 'second-token-' || md5(random()::text);
  h1 text; h2 text; passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@fix.test');
  insert into public.workspaces (slug, name, created_by) values ('fix-test-a', 'A', olga) returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner');
  h1 := encode(sha256(convert_to(tok1, 'utf8')), 'hex');
  h2 := encode(sha256(convert_to(tok2, 'utf8')), 'hex');

  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.invite_member(ws, 'zed@fix.test', 'staff', h1, req);
  perform public.queue_invite_email(inv, tok1, req);
  -- The response was lost, so the admin taps Send again with the same request id and a fresh token.
  inv2 := public.invite_member(ws, 'zed@fix.test', 'staff', h2, req);
  inv3 := public.queue_invite_email(inv2, tok2, req);
  reset role;
  perform set_config('request.jwt.claims', '', true);

  r := r || (case when inv2 = inv then 'PASS' else 'FAIL' end || ' the retry reuses the invitation');
  select (token_hash = h1)::text into t from public.invites where id = inv;
  r := r || (case when t = 'true' then 'PASS' else 'FAIL' end || ' and does not rotate the token (the emailed link stays valid)');
  select count(*) into n from public.outbox where workspace_id = ws and template = 'team_invite';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and one email is queued (' || n || ')');
  select payload ->> 'token' into t from public.outbox where workspace_id = ws and template = 'team_invite';
  r := r || (case when t = tok1 and encode(sha256(convert_to(t, 'utf8')), 'hex') = (select token_hash from public.invites where id = inv) then 'PASS' else 'FAIL' end || ' whose token still matches the invitation');

  -- A deliberate "Send again" (a new request id) does rotate, and the old email's token no longer matches.
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv2 := public.invite_member(ws, 'zed@fix.test', 'staff', h2, '44444444-4444-4444-4444-444444444444');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when (select token_hash from public.invites where id = inv) = h2 then 'PASS' else 'FAIL' end || ' a new request id issues a new token');
  r := r || (case when encode(sha256(convert_to(tok1, 'utf8')), 'hex') <> (select token_hash from public.invites where id = inv) then 'PASS' else 'FAIL' end || ' so the first email''s token is out of date (the worker drops it)');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'REVIEW FIX TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
