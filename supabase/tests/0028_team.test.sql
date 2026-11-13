-- Tests for 0028_team: invites, accepting, the audit log, the last-owner rule and the role matrix
-- (spec section 3). Ends by raising "TEAM TESTS: n passed, m failed" (rolls back).

-- Runs one statement as a signed-in user. Returns the rows it touched, or -1 if it was refused.
create function pg_temp.probe(uid uuid, q text) returns int language plpgsql as $f$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
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
  olga uuid := gen_random_uuid(); adam uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid();
  zed uuid := gen_random_uuid(); eve uuid := gen_random_uuid(); late uuid := gen_random_uuid();
  ws uuid; ws2 uuid; c uuid; sup uuid; prod uuid; inv uuid; po uuid; pay uuid; invite_id uuid; invite2 uuid; mid uuid;
  tok text := 'tok-' || md5(random()::text); h text; tok2 text := 'tok-' || md5(random()::text);
  passed int; failed int;
  probe record; code text; uid uuid; q text; ok boolean; want boolean; bad text := '';
begin
  insert into auth.users (id, email) values
    (olga, 'olga@team.test'), (adam, 'adam@team.test'), (sam, 'sam@team.test'), (acc, 'acc@team.test'),
    (zed, 'zed@team.test'), (eve, 'eve@team.test'), (late, 'late@team.test');
  insert into public.workspaces (slug, name, created_by) values ('team-test-a', 'Olga Plumbing', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('team-test-b', 'Eve Co', eve) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values
    (ws, olga, 'owner'), (ws, adam, 'admin'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id, business_name) values (ws, 'Olga Plumbing'), (ws2, 'Eve Co');
  update public.profiles set full_name = 'Olga Owner' where id = olga;

  -- ---------------------------------------------------------------- invites
  h := encode(sha256(convert_to(tok, 'utf8')), 'hex');
  r := r || (case when pg_temp.probe(sam, format($q$select public.invite_member('%s','new@team.test','staff','%s')$q$, ws, h)) = -1
                  then 'PASS' else 'FAIL' end || ' staff cannot invite');
  r := r || (case when pg_temp.probe(acc, format($q$select public.invite_member('%s','new@team.test','staff','%s')$q$, ws, h)) = -1
                  then 'PASS' else 'FAIL' end || ' the accountant cannot invite');
  r := r || (case when pg_temp.probe(eve, format($q$select public.invite_member('%s','new@team.test','staff','%s')$q$, ws, h)) = -1
                  then 'PASS' else 'FAIL' end || ' another business owner cannot invite into this one');
  r := r || (case when pg_temp.probe(olga, format($q$select public.invite_member('%s','zed@team.test','owner','%s')$q$, ws, h)) = -1
                  then 'PASS' else 'FAIL' end || ' ownership cannot be given by invitation');
  r := r || (case when pg_temp.probe(olga, format($q$select public.invite_member('%s','sam@team.test','staff','%s')$q$, ws, h)) = -1
                  then 'PASS' else 'FAIL' end || ' someone who is already a member cannot be invited');
  r := r || (case when pg_temp.probe(olga, format($q$select public.invite_member('%s','not-an-email','staff','%s')$q$, ws, h)) = -1
                  then 'PASS' else 'FAIL' end || ' a bad email is refused');

  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  invite_id := public.invite_member(ws, ' Zed@Team.test ', 'staff', h);
  reset role;
  select email || '/' || role into t from public.invites where id = invite_id;
  r := r || (case when t = 'zed@team.test/staff' then 'PASS' else 'FAIL' end || ' an admin or owner can invite, email is lower-cased (' || t || ')');
  r := r || (case when exists (select 1 from public.audit_log where workspace_id = ws and action = 'member.invited' and actor_id = olga)
                  then 'PASS' else 'FAIL' end || ' and the invitation is in the activity log');

  -- inviting the same person again refreshes the one invitation (new token, new role)
  perform set_config('request.jwt.claims', json_build_object('sub', adam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  invite2 := public.invite_member(ws, 'zed@team.test', 'accountant', encode(sha256(convert_to(tok2, 'utf8')), 'hex'));
  reset role;
  select count(*)::text || '/' || max(role) into t from public.invites where workspace_id = ws and email = 'zed@team.test';
  r := r || (case when invite2 = invite_id and t = '1/accountant' then 'PASS' else 'FAIL' end || ' inviting again reuses the invitation (' || t || ')');
  r := r || (case when exists (select 1 from public.invites where id = invite_id and token_hash = encode(sha256(convert_to(tok2, 'utf8')), 'hex'))
                  then 'PASS' else 'FAIL' end || ' with the new token');

  -- the public preview says who is asking, and nothing more
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  res := public.invite_preview(encode(sha256(convert_to(tok2, 'utf8')), 'hex'));
  reset role;
  r := r || (case when res ->> 'business' = 'Olga Plumbing' and res ->> 'role' = 'accountant' and res ->> 'email_hint' = 'z**@team.test'
                  then 'PASS' else 'FAIL' end || ' the invitation preview shows the business, role and a masked email (' || res::text || ')');
  r := r || (case when not (res ? 'email') and not (res ? 'workspace_id') and not (res ? 'id') then 'PASS' else 'FAIL' end || ' and no ids or full email');
  set local role anon;
  res := public.invite_preview('00');
  reset role;
  r := r || (case when res is null then 'PASS' else 'FAIL' end || ' an unknown token previews as nothing');

  -- queueing the email needs the real token
  r := r || (case when pg_temp.probe(olga, format($q$select public.queue_invite_email('%s','wrong-token','%s')$q$, invite_id, gen_random_uuid())) = -1
                  then 'PASS' else 'FAIL' end || ' the invitation email needs the matching token');
  r := r || (case when pg_temp.probe(sam, format($q$select public.queue_invite_email('%s','%s','%s')$q$, invite_id, tok2, gen_random_uuid())) = -1
                  then 'PASS' else 'FAIL' end || ' and the right role');
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.queue_invite_email(invite_id, tok2, '11111111-1111-1111-1111-111111111111');
  perform public.queue_invite_email(invite_id, tok2, '11111111-1111-1111-1111-111111111111');
  reset role;
  select count(*) into n from public.outbox where workspace_id = ws and template = 'team_invite' and to_address = 'zed@team.test';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the same request id queues one email (' || n || ')');

  -- accepting
  r := r || (case when pg_temp.probe(late, format($q$select public.accept_invite('%s')$q$, encode(sha256(convert_to(tok2, 'utf8')), 'hex'))) = -1
                  then 'PASS' else 'FAIL' end || ' a different email cannot use the invitation');
  r := r || (case when pg_temp.probe(zed, $q$select public.accept_invite('nothing')$q$) = -1
                  then 'PASS' else 'FAIL' end || ' an unknown token is refused');
  r := r || (case when pg_temp.probe(zed, format($q$select public.accept_invite('%s')$q$, encode(sha256(convert_to(tok, 'utf8')), 'hex'))) = -1
                  then 'PASS' else 'FAIL' end || ' the old token no longer works');
  perform set_config('request.jwt.claims', json_build_object('sub', zed, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.accept_invite(encode(sha256(convert_to(tok2, 'utf8')), 'hex'));
  reset role;
  select role into t from public.memberships where workspace_id = ws and user_id = zed;
  r := r || (case when t = 'accountant' and res ->> 'slug' = 'team-test-a' then 'PASS' else 'FAIL' end || ' the invited person joins with the invited role (' || coalesce(t, 'none') || ')');
  r := r || (case when exists (select 1 from public.audit_log where workspace_id = ws and action = 'member.joined' and actor_id = zed)
                  then 'PASS' else 'FAIL' end || ' and the join is logged');
  perform set_config('request.jwt.claims', json_build_object('sub', zed, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.accept_invite(encode(sha256(convert_to(tok2, 'utf8')), 'hex'));
  reset role;
  select count(*) into n from public.memberships where workspace_id = ws and user_id = zed;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' accepting twice joins once');

  perform set_config('request.jwt.claims', '', true);
  update public.invites set accepted_at = null, expires_at = now() - interval '1 day' where id = invite_id;
  delete from public.memberships where workspace_id = ws and user_id = zed;
  r := r || (case when pg_temp.probe(zed, format($q$select public.accept_invite('%s')$q$, encode(sha256(convert_to(tok2, 'utf8')), 'hex'))) = -1
                  then 'PASS' else 'FAIL' end || ' an expired invitation is refused');

  -- a workspace holds at most 25 open invitations
  for n in 1..25 loop
    insert into public.invites (workspace_id, email, role, token_hash, invited_by)
    values (ws, 'bulk' || n || '@team.test', 'staff', 'bulk-hash-' || n, olga);
  end loop;
  r := r || (case when pg_temp.probe(olga, format($q$select public.invite_member('%s','one-too-many@team.test','staff','%s')$q$, ws, encode(sha256(convert_to('cap', 'utf8')), 'hex'))) = -1
                  then 'PASS' else 'FAIL' end || ' the 26th open invitation is refused');
  delete from public.invites where workspace_id = ws and email like 'bulk%';

  -- ------------------------------------------------- the team list and its emails
  perform set_config('request.jwt.claims', json_build_object('sub', adam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), max(member_email) filter (where member_name = 'Olga Owner') into n, t from public.list_members(ws);
  reset role;
  r := r || (case when n = 4 and t = 'olga@team.test' then 'PASS' else 'FAIL' end || ' an admin sees all members with emails (' || n || ', ' || coalesce(t, 'none') || ')');
  r := r || (case when pg_temp.probe(sam, format($q$select * from public.list_members('%s')$q$, ws)) = -1
                  then 'PASS' else 'FAIL' end || ' staff cannot list members with emails');
  r := r || (case when pg_temp.probe(eve, format($q$select * from public.list_members('%s')$q$, ws)) = -1
                  then 'PASS' else 'FAIL' end || ' nor can another business');

  -- ------------------------------------------- roles, removal and the last owner
  r := r || (case when pg_temp.probe(olga, format($q$update public.memberships set role = 'staff' where workspace_id = '%s' and user_id = '%s'$q$, ws, olga)) = -1
                  then 'PASS' else 'FAIL' end || ' the last owner cannot be demoted');
  r := r || (case when pg_temp.probe(olga, format($q$delete from public.memberships where workspace_id = '%s' and user_id = '%s'$q$, ws, olga)) = -1
                  then 'PASS' else 'FAIL' end || ' the last owner cannot leave or be removed');
  r := r || (case when pg_temp.probe(adam, format($q$update public.memberships set role = 'owner' where workspace_id = '%s' and user_id = '%s'$q$, ws, sam)) = -1
                  then 'PASS' else 'FAIL' end || ' an admin cannot make someone an owner');
  r := r || (case when pg_temp.probe(adam, format($q$delete from public.memberships where workspace_id = '%s' and user_id = '%s'$q$, ws, olga)) = -1
                  then 'PASS' else 'FAIL' end || ' an admin cannot remove an owner');
  r := r || (case when pg_temp.probe(sam, format($q$delete from public.memberships where workspace_id = '%s' and user_id = '%s'$q$, ws, acc)) = 0
                  then 'PASS' else 'FAIL' end || ' staff cannot remove anyone');
  r := r || (case when pg_temp.probe(sam, format($q$update public.memberships set role = 'admin' where workspace_id = '%s' and user_id = '%s'$q$, ws, sam)) = 0
                  then 'PASS' else 'FAIL' end || ' staff cannot promote themselves');

  r := r || (case when pg_temp.probe(adam, format($q$update public.memberships set role = 'admin' where workspace_id = '%s' and user_id = '%s'$q$, ws, sam)) = 1
                  then 'PASS' else 'FAIL' end || ' an admin can change a role');
  r := r || (case when exists (select 1 from public.audit_log where workspace_id = ws and action = 'member.role_changed' and actor_id = adam and summary like '%staff%admin%')
                  then 'PASS' else 'FAIL' end || ' and it is logged with from and to');
  update public.memberships set role = 'staff' where workspace_id = ws and user_id = sam;

  -- a second owner makes the first removable; a member can leave on their own
  update public.memberships set role = 'owner' where workspace_id = ws and user_id = adam;
  r := r || (case when pg_temp.probe(olga, format($q$delete from public.memberships where workspace_id = '%s' and user_id = '%s'$q$, ws, adam)) = 1
                  then 'PASS' else 'FAIL' end || ' with two owners one can be removed');
  r := r || (case when exists (select 1 from public.audit_log where workspace_id = ws and action = 'member.removed')
                  then 'PASS' else 'FAIL' end || ' and the removal is logged');
  insert into public.memberships (workspace_id, user_id, role) values (ws, adam, 'admin');
  r := r || (case when pg_temp.probe(acc, format($q$delete from public.memberships where workspace_id = '%s' and user_id = '%s'$q$, ws, acc)) = 1
                  then 'PASS' else 'FAIL' end || ' a member can leave');
  r := r || (case when exists (select 1 from public.audit_log where workspace_id = ws and action = 'member.left')
                  then 'PASS' else 'FAIL' end || ' and it says they left');
  insert into public.memberships (workspace_id, user_id, role) values (ws, acc, 'accountant');
  r := r || (case when pg_temp.probe(acc, format($q$select 1 from public.sales_documents where workspace_id = '%s'$q$, ws)) >= 0
                  then 'PASS' else 'FAIL' end || ' (sanity) the accountant is back');

  -- ----------------------------------------------------- the activity log
  insert into public.contacts (workspace_id, name) values (ws, 'Seed') returning id into c;
  insert into public.suppliers (workspace_id, name) values (ws, 'Supplier') returning id into sup;
  insert into public.products (workspace_id, name, track_stock) values (ws, 'Tile', true) returning id into prod;
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.save_document_draft(ws, null, jsonb_build_object('kind', 'invoice', 'contact_id', c),
    '[{"description":"Work","quantity":1,"unit_cents":10000,"vat_rate":0}]'::jsonb);
  perform public.send_document(inv);
  perform public.adjust_stock(prod, 5, 'initial', null);
  perform public.record_manual_payment(inv, 4000, 'cash', null, 'cash', null, gen_random_uuid());
  select id into pay from public.payments where document_id = inv;
  perform public.remove_payment(pay);
  perform public.void_document(inv);
  insert into public.purchase_orders (workspace_id, supplier_id) values (ws, sup) returning id into po;
  insert into public.purchase_order_lines (workspace_id, po_id, product_id, quantity, unit_cost_cents) values (ws, po, prod, 2, 100);
  perform public.receive_purchase_order(po, false);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  for t in select unnest(array['document.sent', 'document.voided', 'stock.adjusted', 'payment.removed', 'purchase_order.received']) loop
    r := r || (case when exists (select 1 from public.audit_log where workspace_id = ws and action = t) then 'PASS' else 'FAIL' end || ' the log records ' || t);
  end loop;
  select summary into t from public.audit_log where workspace_id = ws and action = 'document.sent' limit 1;
  r := r || (case when t like '%INV-%' then 'PASS' else 'FAIL' end || ' with the document number (' || coalesce(t, '') || ')');

  r := r || (case when pg_temp.probe(sam, format($q$select 1 from public.audit_log where workspace_id = '%s'$q$, ws)) = 0
                  then 'PASS' else 'FAIL' end || ' staff see an empty log');
  r := r || (case when pg_temp.probe(olga, format($q$select 1 from public.audit_log where workspace_id = '%s'$q$, ws)) > 0
                  then 'PASS' else 'FAIL' end || ' owners see the log');
  r := r || (case when pg_temp.probe(eve, format($q$select 1 from public.audit_log where workspace_id = '%s'$q$, ws)) = 0
                  then 'PASS' else 'FAIL' end || ' another business sees nothing');
  r := r || (case when pg_temp.probe(olga, format($q$insert into public.audit_log (workspace_id, action, summary) values ('%s','x','x')$q$, ws)) = -1
                  then 'PASS' else 'FAIL' end || ' the log cannot be written by hand');
  r := r || (case when pg_temp.probe(olga, format($q$delete from public.audit_log where workspace_id = '%s'$q$, ws)) = -1
                  then 'PASS' else 'FAIL' end || ' or erased');
  r := r || (case when pg_temp.probe(olga, format($q$update public.audit_log set summary = 'x' where workspace_id = '%s'$q$, ws)) = -1
                  then 'PASS' else 'FAIL' end || ' or edited');

  -- ------------------------------------------------------- the role matrix
  insert into public.expenses (workspace_id, spent_on, amount_cents, payment_method) values (ws, current_date, 100, 'cash');
  insert into public.bank_imports (workspace_id, file_name) values (ws, 'f.csv');
  insert into public.payment_connections (workspace_id, provider, mode) values (ws, 'yoco', 'test');
  insert into public.outbox (workspace_id, template, to_address, idempotency_key) values (ws, 'document', 'x@team.test', 'matrix-outbox-key');
  insert into public.workspace_modules (workspace_id, module, enabled) values (ws, 'reports', false) on conflict do nothing;
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values (ws, prod, 1, 'adjustment');
  insert into public.invites (workspace_id, email, role, token_hash) values (ws, 'matrix@team.test', 'staff', 'matrix-hash');

  for probe in
    select * from (values
      ('read contacts',          $q$select 1 from public.contacts where workspace_id = '{ws}'$q$,                                        'oasc'),
      ('add a contact',          $q$insert into public.contacts (workspace_id, name) values ('{ws}', 'm-{r}')$q$,                        'oas'),
      ('edit a contact',         $q$update public.contacts set name = 'u-{r}' where id = '{c}'$q$,           'oas'),
      ('start an invoice',       $q$insert into public.sales_documents (workspace_id, kind, contact_id) values ('{ws}', 'invoice', '{c}')$q$, 'oas'),
      ('read invoices',          $q$select 1 from public.sales_documents where workspace_id = '{ws}'$q$,                                  'oasc'),
      ('log an expense',         $q$insert into public.expenses (workspace_id, spent_on, amount_cents, payment_method) values ('{ws}', current_date, 500, 'cash')$q$, 'oas'),
      ('read expenses',          $q$select 1 from public.expenses where workspace_id = '{ws}'$q$,                                         'oasc'),
      ('add a task',             $q$insert into public.tasks (workspace_id, title) values ('{ws}', 't-{r}')$q$,                           'oas'),
      ('add a product',          $q$insert into public.products (workspace_id, name) values ('{ws}', 'p-{r}')$q$,                         'oas'),
      ('start a purchase order', $q$insert into public.purchase_orders (workspace_id, supplier_id) values ('{ws}', '{sup}')$q$,            'oas'),
      ('read stock movements',   $q$select 1 from public.stock_movements where workspace_id = '{ws}'$q$,                                  'oasc'),
      ('write a stock movement', $q$insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values ('{ws}', '{prod}', 1, 'adjustment')$q$, ''),
      ('read bank statements',   $q$select 1 from public.bank_imports where workspace_id = '{ws}'$q$,                                     'oac'),
      ('set up bookings',        $q$insert into public.services (workspace_id, name, duration_min) values ('{ws}', 's-{r}', 30)$q$,       'oa'),
      ('edit business details',  $q$update public.workspace_settings set business_name = 'B-{r}' where workspace_id = '{ws}'$q$,          'oa'),
      ('rename the workspace',   $q$update public.workspaces set name = 'W-{r}' where id = '{ws}'$q$,                                     'oa'),
      ('switch modules',         $q$update public.workspace_modules set enabled = true where workspace_id = '{ws}'$q$,                    'oa'),
      ('read payment keys list', $q$select 1 from public.payment_connections where workspace_id = '{ws}'$q$,                              'oa'),
      ('read the outbox',        $q$select 1 from public.outbox where workspace_id = '{ws}'$q$,                                           'oa'),
      ('read invitations',       $q$select 1 from public.invites where workspace_id = '{ws}'$q$,                                          'oa'),
      ('create an invitation',   $q$insert into public.invites (workspace_id, email, role, token_hash, invited_by) values ('{ws}', 'x{r}@m.test', 'staff', 'h{r}', auth.uid())$q$, 'oa'),
      ('read the team',          $q$select 1 from public.memberships where workspace_id = '{ws}'$q$,                                      'oasc'),
      ('read the log',           $q$select 1 from public.audit_log where workspace_id = '{ws}'$q$,                                        'oa')
    ) as v (label, sql, allowed)
  loop
    foreach code in array array['o', 'a', 's', 'c'] loop
      uid := case code when 'o' then olga when 'a' then adam when 's' then sam else acc end;
      q := replace(replace(replace(replace(replace(probe.sql, '{ws}', ws::text), '{r}', substr(md5(random()::text), 1, 8)), '{c}', c::text), '{sup}', sup::text), '{prod}', prod::text);
      n := pg_temp.probe(uid, q);
      ok := n > 0;
      want := position(code in probe.allowed) > 0;
      if ok <> want then
        bad := bad || probe.label || ' as ' || code || ' (rows ' || n || ', wanted ' || case when want then 'allowed' else 'refused' end || '); ';
      end if;
    end loop;
  end loop;
  r := r || (case when bad = '' then 'PASS' else 'FAIL' end || ' role matrix: 23 actions x 4 roles all match the spec' || case when bad = '' then '' else ' — ' || bad end);

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'TEAM TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
