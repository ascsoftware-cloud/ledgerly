-- Tests for 0024_time_min_quantity. Raises "SHORT ENTRY: <hours> (expected 0.01)" (rolls back).
-- Before the fix this raised a check_violation on sales_document_lines.quantity.
do $$
declare
  alice uuid := gen_random_uuid(); ws uuid; c uuid; p uuid; e uuid; inv uuid; t text;
begin
  insert into auth.users (id, email) values (alice, 'alice@short.test');
  insert into public.workspaces (slug, name, created_by) values ('short-test', 'A', alice) returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner');
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;
  insert into public.projects (workspace_id, name, contact_id, hourly_rate_cents) values (ws, 'Kitchen', c, 45000) returning id into p;
  insert into public.time_entries (workspace_id, project_id, user_id, started_at, ended_at) values (ws, p, alice, '2026-11-11 07:00:00+00', '2026-11-11 07:00:05+00') returning id into e;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.invoice_time_entries(p, array[e]);
  select trim_scale(quantity)::text into t from public.sales_document_lines where document_id = inv;
  raise exception 'SHORT ENTRY: % (expected 0.01)', t;
end;
$$;
