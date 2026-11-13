-- Tests for 0035_search. Ends by raising "SEARCH TESTS: n passed, m failed" (rolls back).
create function pg_temp.found(uid uuid, ws uuid, q text) returns text language plpgsql as $f$
declare res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select coalesce(string_agg(s.kind || ':' || s.title, ',' order by s.kind, s.title), '') into res from public.search(ws, q) s;
  exception when others then
    res := 'ERROR';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return res;
end
$f$;

do $$
declare
  r text[] := '{}';
  olga uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws2 uuid; c1 uuid; c2 uuid; c3 uuid;
  t text; passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@search.test'), (sam, 'sam@search.test'), (eve, 'eve@search.test');
  insert into public.workspaces (slug, name, created_by) values ('search-test-a', 'A', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('search-test-b', 'B', eve) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner'), (ws, sam, 'staff'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws2);

  insert into public.contacts (workspace_id, name, email) values (ws, 'Naledi Dlamini', 'naledi@tiles.co.za') returning id into c1;
  insert into public.contacts (workspace_id, name) values (ws, 'Pieter Botha') returning id into c2;
  insert into public.contacts (workspace_id, name, deleted_at) values (ws, 'Naledi Archived', now());
  insert into public.contacts (workspace_id, name) values (ws2, 'Naledi Other Business') returning id into c3;
  insert into public.sales_documents (workspace_id, kind, status, number, contact_id) values (ws, 'invoice', 'sent', 'INV-0042', c1);
  insert into public.sales_documents (workspace_id, kind, status, contact_id) values (ws, 'quote', 'draft', c2);
  insert into public.tasks (workspace_id, title) values (ws, 'Order grout for Naledi');
  insert into public.projects (workspace_id, name) values (ws, 'Bathroom tiling');
  insert into public.projects (workspace_id, name, deleted_at) values (ws, 'Bathroom old', now());
  insert into public.products (workspace_id, name, sku) values (ws, 'Ceramic tile 300x300', 'TILE-300');
  insert into public.sales_documents (workspace_id, kind, status, number, contact_id) values (ws2, 'invoice', 'sent', 'INV-0042', c3);

  t := pg_temp.found(olga, ws, 'naledi');
  r := r || (case when t = 'client:Naledi Dlamini,invoice:INV-0042,task:Order grout for Naledi' then 'PASS' else 'FAIL' end || ' one word finds clients, invoices and tasks (' || t || ')');
  t := pg_temp.found(olga, ws, 'NALEDI');
  r := r || (case when t like 'client:Naledi Dlamini%' then 'PASS' else 'FAIL' end || ' capitals do not matter');
  t := pg_temp.found(olga, ws, 'inv-004');
  r := r || (case when t = 'invoice:INV-0042' then 'PASS' else 'FAIL' end || ' part of an invoice number works (' || t || ')');
  t := pg_temp.found(olga, ws, 'grout naledi');
  r := r || (case when t = 'task:Order grout for Naledi' then 'PASS' else 'FAIL' end || ' every word must match (' || t || ')');
  t := pg_temp.found(olga, ws, 'tile');
  r := r || (case when t = 'client:Naledi Dlamini,product:Ceramic tile 300x300' then 'PASS' else 'FAIL' end || ' products and emails are found by part of a word (' || t || ')');
  t := pg_temp.found(olga, ws, 'tile-300');
  r := r || (case when t = 'product:Ceramic tile 300x300' then 'PASS' else 'FAIL' end || ' and by SKU');
  t := pg_temp.found(olga, ws, 'bathroom');
  r := r || (case when t = 'project:Bathroom tiling' then 'PASS' else 'FAIL' end || ' archived projects are left out (' || t || ')');
  t := pg_temp.found(olga, ws, 'pieter');
  r := r || (case when t = 'client:Pieter Botha,quote:Draft quote' then 'PASS' else 'FAIL' end || ' a draft quote is found by its client (' || t || ')');
  t := pg_temp.found(olga, ws, 'archived');
  r := r || (case when t = '' then 'PASS' else 'FAIL' end || ' archived clients are left out (' || t || ')');

  t := pg_temp.found(olga, ws, '%');
  r := r || (case when t = '' then 'PASS' else 'FAIL' end || ' a lone % is too short, so nothing matches (' || t || ')');
  t := pg_temp.found(olga, ws, '%%');
  r := r || (case when t = '' then 'PASS' else 'FAIL' end || ' wildcards typed by a person are matched literally (' || t || ')');
  t := pg_temp.found(olga, ws, 'n_ledi');
  r := r || (case when t = '' then 'PASS' else 'FAIL' end || ' so is an underscore (' || t || ')');
  t := pg_temp.found(olga, ws, 'a');
  r := r || (case when t = '' then 'PASS' else 'FAIL' end || ' one letter is not searched');
  t := pg_temp.found(olga, ws, '   ');
  r := r || (case when t = '' then 'PASS' else 'FAIL' end || ' blank is not searched');
  t := pg_temp.found(olga, ws, 'x'' or 1=1 --');
  r := r || (case when t = '' then 'PASS' else 'FAIL' end || ' quotes are just text (' || t || ')');

  t := pg_temp.found(sam, ws, 'naledi');
  r := r || (case when t like 'client:Naledi Dlamini%' then 'PASS' else 'FAIL' end || ' staff can search too');
  t := pg_temp.found(eve, ws, 'naledi');
  r := r || (case when t = 'ERROR' then 'PASS' else 'FAIL' end || ' someone from another business cannot search this one (' || t || ')');
  t := pg_temp.found(eve, ws2, 'naledi');
  r := r || (case when t = 'client:Naledi Other Business,invoice:INV-0042' then 'PASS' else 'FAIL' end || ' and sees only their own (' || t || ')');
  t := pg_temp.found(olga, ws2, 'naledi');
  r := r || (case when t = 'ERROR' then 'PASS' else 'FAIL' end || ' even with the right words, the wrong business is refused');

  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    perform * from public.search(ws, 'naledi');
    reset role;
    r := r || 'FAIL the public searched'::text;
  exception when others then
    reset role;
    r := r || 'PASS the public cannot search'::text;
  end;
  perform set_config('request.jwt.claims', '', true);

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'SEARCH TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
