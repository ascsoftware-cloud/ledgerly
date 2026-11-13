-- Tests for 0039_popia. Ends by raising "POPIA TESTS: n passed, m failed" (rolls back).
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

-- Calls a function as a signed-in person and returns its jsonb/timestamptz result as text, or 'ERR:<sqlstate>'.
create function pg_temp.as_user(uid uuid, q text) returns text language plpgsql as $f$
declare res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute q into res;
  exception when others then
    res := 'ERR:' || sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return res;
end
$f$;

do $$
declare
  r text[] := '{}';
  n int; t text; j jsonb;
  olga uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); eve uuid := gen_random_uuid(); lone uuid := gen_random_uuid();
  ws uuid; ws2 uuid; ws_l uuid; c uuid; c2 uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@pop.test'), (sam, 'sam@pop.test'), (eve, 'eve@pop.test'), (lone, 'lone@pop.test');
  insert into public.profiles (id, full_name) values (olga, 'Olga'), (sam, 'Sam'), (eve, 'Eve'), (lone, 'Lone') on conflict (id) do nothing;
  insert into public.workspaces (slug, name, created_by) values ('pop-test-a', 'A', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('pop-test-b', 'B', eve) returning id into ws2;
  insert into public.workspaces (slug, name, created_by) values ('pop-test-l', 'L', lone) returning id into ws_l;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner'), (ws, sam, 'staff'), (ws2, eve, 'owner'), (ws_l, lone, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws2), (ws_l);
  insert into public.contacts (workspace_id, name, email) values (ws, 'Client A', 'a@c.test') returning id into c;
  insert into public.contacts (workspace_id, name, email) values (ws2, 'Client B', 'b@c.test') returning id into c2;

  -- Consents
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.consents (user_id, workspace_id, kind, granted, version) values ('%s', '%s', 'ai_provider', true, 'v1')$q$, olga, ws)) = 1 then 'PASS' else 'FAIL' end || ' a person can record their own consent');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.consents (user_id, kind, granted, version) values ('%s', 'push', true, 'v1')$q$, sam)) = -1 then 'PASS' else 'FAIL' end || ' but not for someone else');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$insert into public.consents (user_id, workspace_id, kind, granted, version) values ('%s', '%s', 'ai_provider', true, 'v1')$q$, eve, ws)) = -1 then 'PASS' else 'FAIL' end || ' nor for a business they are not in');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select 1 from public.consents where user_id = '%s'$q$, olga)) = 0 then 'PASS' else 'FAIL' end || ' and nobody reads another person''s consents');
  r := r || (case when pg_temp.probe('authenticated', olga, $q$update public.consents set granted = false$q$) = -1 then 'PASS' else 'FAIL' end || ' they are a log: never edited');
  r := r || (case when pg_temp.probe('anon', null, $q$select 1 from public.consents$q$) = -1 then 'PASS' else 'FAIL' end || ' and the public sees nothing');

  -- Export
  t := pg_temp.as_user(sam, format($q$select public.export_workspace('%s')::text$q$, ws));
  r := r || (case when t = 'ERR:LDG03' then 'PASS' else 'FAIL' end || ' only the owner can export (staff refused: ' || t || ')');
  t := pg_temp.as_user(eve, format($q$select public.export_workspace('%s')::text$q$, ws));
  r := r || (case when t = 'ERR:LDG03' then 'PASS' else 'FAIL' end || ' nor an owner of another business (' || t || ')');
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.export_workspace(ws);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when jsonb_array_length(j -> 'contacts') = 1 and j -> 'contacts' -> 0 ->> 'name' = 'Client A' then 'PASS' else 'FAIL' end || ' the export has this business''s clients');
  r := r || (case when j::text not like '%Client B%' and j::text not like '%b@c.test%' then 'PASS' else 'FAIL' end || ' and nothing from another business');
  r := r || (case when jsonb_array_length(j -> 'workspaces') = 1 and j -> 'workspaces' -> 0 ->> 'slug' = 'pop-test-a' then 'PASS' else 'FAIL' end || ' with the business itself');
  r := r || (case when jsonb_array_length(j -> 'memberships') = 2 then 'PASS' else 'FAIL' end || ' and its team');
  select count(*) into n from information_schema.tables tb
    where tb.table_schema = 'public' and tb.table_type = 'BASE TABLE'
      and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = tb.table_name and c.column_name = 'workspace_id')
      and not (j ? tb.table_name)
      and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = tb.table_name and has_column_privilege('authenticated', format('public.%I', tb.table_name), c.column_name, 'SELECT'));
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' every table that has a business column and that the owner may read is in it (' || n || ' missing)');
  r := r || (case when not (j ? 'billing_checkouts') and not (j ? 'billing_events') then 'PASS' else 'FAIL' end || ' but tables the owner may not read are not');
  insert into public.subscriptions (workspace_id, status, token, price_cents, current_period_end) values (ws, 'active', 'SECRET-TOKEN-XYZ', 19900, now() + interval '1 month');
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.export_workspace(ws);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  r := r || (case when jsonb_array_length(j -> 'subscriptions') = 1 and j::text not like '%SECRET-TOKEN-XYZ%' then 'PASS' else 'FAIL' end || ' the subscription is exported without its PayFast token');
  delete from public.subscriptions where workspace_id = ws;
  r := r || (case when pg_temp.probe('anon', null, format($q$select public.export_workspace('%s')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' the public cannot export');

  -- Deleting a business: owner only, 7 days, cancellable
  t := pg_temp.as_user(sam, format($q$select public.request_workspace_deletion('%s')::text$q$, ws));
  r := r || (case when t = 'ERR:LDG03' then 'PASS' else 'FAIL' end || ' staff cannot delete a business');
  t := pg_temp.as_user(eve, format($q$select public.request_workspace_deletion('%s')::text$q$, ws));
  r := r || (case when t = 'ERR:LDG03' then 'PASS' else 'FAIL' end || ' nor another business''s owner');
  insert into public.subscriptions (workspace_id, status, token, price_cents, current_period_end) values (ws, 'active', 'tok', 19900, now() + interval '1 month');
  t := pg_temp.as_user(olga, format($q$select public.request_workspace_deletion('%s')::text$q$, ws));
  r := r || (case when t = 'ERR:LDG03' then 'PASS' else 'FAIL' end || ' an active Pro subscription must be cancelled first');
  update public.subscriptions set status = 'cancelling' where workspace_id = ws;
  t := pg_temp.as_user(olga, format($q$select public.request_workspace_deletion('%s')::text$q$, ws));
  r := r || (case when t not like 'ERR:%' and t::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' then 'PASS' else 'FAIL' end || ' the owner can, and it is 7 days away (' || t || ')');
  r := r || (case when (public.purge_due() -> 'workspaces') = '[]'::jsonb then 'PASS' else 'FAIL' end || ' nothing is due yet');
  update public.workspaces set deletion_requested_at = now() - interval '8 days' where id = ws;
  r := r || (case when (public.purge_due() -> 'workspaces') @> jsonb_build_array(ws) then 'PASS' else 'FAIL' end || ' after the grace it is due');
  r := r || (case when pg_temp.probe('authenticated', olga, 'select public.purge_due()') = -1 then 'PASS' else 'FAIL' end || ' and only the server can ask what is due');
  perform pg_temp.as_user(olga, format($q$select public.cancel_workspace_deletion('%s')::text$q$, ws));
  select count(*) into n from public.workspaces where id = ws and deletion_requested_at is null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the owner can cancel before then');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$update public.workspaces set deletion_requested_at = now() where id = '%s'$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' the flag cannot be set by hand');
  delete from public.subscriptions where workspace_id = ws;

  -- Deleting an account
  t := pg_temp.as_user(olga, 'select public.request_account_deletion()::text');
  r := r || (case when t = 'ERR:LDG03' then 'PASS' else 'FAIL' end || ' someone who owns a business with other people in it must deal with them first (' || t || ')');
  r := r || (case when (select deletion_requested_at from public.profiles where id = olga) is null then 'PASS' else 'FAIL' end || ' and nothing was flagged');
  t := pg_temp.as_user(lone, 'select public.request_account_deletion()::text');
  r := r || (case when t not like 'ERR:%' then 'PASS' else 'FAIL' end || ' a sole owner can (' || t || ')');
  r := r || (case when (select deletion_requested_at from public.workspaces where id = ws_l) is not null and (select deletion_requested_by from public.workspaces where id = ws_l) = lone then 'PASS' else 'FAIL' end || ' their business is flagged too');
  r := r || (case when (select count(*) from public.workspaces where id in (ws, ws2) and deletion_requested_at is not null) = 0 then 'PASS' else 'FAIL' end || ' and nobody else''s');
  update public.profiles set deletion_requested_at = now() - interval '8 days' where id = lone;
  r := r || (case when (public.purge_due() -> 'users') @> jsonb_build_array(lone) then 'PASS' else 'FAIL' end || ' after the grace the account is due');
  perform pg_temp.as_user(lone, 'select public.cancel_account_deletion()::text');
  r := r || (case when (select deletion_requested_at from public.profiles where id = lone) is null and (select deletion_requested_at from public.workspaces where id = ws_l) is null then 'PASS' else 'FAIL' end || ' cancelling restores the account and its business');
  r := r || (case when pg_temp.probe('anon', null, 'select public.request_account_deletion()') = -1 then 'PASS' else 'FAIL' end || ' the public cannot request deletion');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'POPIA TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
