-- Tests for 0056_nav_tabs. Ends by raising "NAV TAB TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  t text;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  shop_ws uuid; trade_ws uuid; empty_ws uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@tabs.test'), (sam, 'sam@tabs.test'), (bob, 'bob@tabs.test');
  insert into public.workspaces (slug, name, created_by) values ('tabs-shop', 'Shop', alice) returning id into shop_ws;
  insert into public.workspaces (slug, name, created_by) values ('tabs-trade', 'Trade', alice) returning id into trade_ws;
  insert into public.workspaces (slug, name, created_by) values ('tabs-empty', 'Empty', bob) returning id into empty_ws;
  insert into public.memberships (workspace_id, user_id, role) values
    (shop_ws, alice, 'owner'), (shop_ws, sam, 'staff'), (trade_ws, alice, 'owner'), (empty_ws, bob, 'owner');
  insert into public.onboarding_answers (workspace_id, user_id, answers) values
    (shop_ws, alice, '{"business":"online_store"}'), (trade_ws, alice, '{"business":"trades"}');

  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select string_agg(tab || '=' || shown, ',' order by tab) into t from public.nav_tabs(shop_ws);
  r := r || (case when t = 'accounting=true,courier=true,shopify=true' then 'PASS' else 'FAIL' end || ' an online store shows all three tabs, even to staff (' || coalesce(t, 'null') || ')');
  select string_agg(tab, ',') into t from public.nav_tabs(trade_ws);
  r := r || (case when t is null then 'PASS' else 'FAIL' end || ' non-members get no tabs');
  begin
    perform public.set_nav_tab(shop_ws, 'shopify', false);
    r := r || 'FAIL staff cannot change the tabs'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot change the tabs'::text;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select shown::text into t from public.nav_tabs(trade_ws) where tab = 'shopify';
  r := r || (case when t = 'false' then 'PASS' else 'FAIL' end || ' a trades business hides Shopify by default');
  perform public.set_nav_tab(trade_ws, 'shopify', true);
  select shown || '/' || is_default into t from public.nav_tabs(trade_ws) where tab = 'shopify';
  r := r || (case when t = 'true/false' then 'PASS' else 'FAIL' end || ' Shopify can be added from More (' || t || ')');
  perform public.set_nav_tab(trade_ws, 'courier', false);
  select shown::text into t from public.nav_tabs(trade_ws) where tab = 'courier';
  r := r || (case when t = 'false' then 'PASS' else 'FAIL' end || ' Courier can be hidden');
  begin
    perform public.set_nav_tab(trade_ws, 'stock', true);
    r := r || 'FAIL unknown tabs are refused'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS unknown tabs are refused'::text;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select shown::text into t from public.nav_tabs(empty_ws) where tab = 'shopify';
  r := r || (case when t = 'false' then 'PASS' else 'FAIL' end || ' no onboarding answers: Shopify hidden by default');
  begin
    perform public.set_nav_tab(trade_ws, 'shopify', false);
    r := r || 'FAIL another workspace cannot change the tabs'::text;
  exception when insufficient_privilege then r := r || 'PASS another workspace cannot change the tabs'::text;
  end;
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'NAV TAB TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
