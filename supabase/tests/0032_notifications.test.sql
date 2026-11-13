-- Tests for 0032_notifications. Ends by raising "NOTIFICATION TESTS: n passed, m failed" (rolls back).
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
  n int; t text; j jsonb;
  olga uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws2 uuid; c uuid; inv uuid; quote uuid; prod uuid; proj uuid; task uuid; svc uuid; tok text;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@note.test'), (sam, 'sam@note.test'), (eve, 'eve@note.test');
  insert into public.workspaces (slug, name, created_by) values ('note-test-a', 'A', olga) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('note-test-b', 'B', eve) returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner'), (ws, sam, 'staff'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws2);
  insert into public.contacts (workspace_id, name, email) values (ws, 'Thandi', 'thandi@client.test') returning id into c;

  -- direct writes are not allowed; reading is for the owner of the row only
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.notifications (workspace_id, user_id, kind, title) values ('%s','%s','daily','x')$q$, ws, olga)) = -1 then 'PASS' else 'FAIL' end || ' notifications cannot be written by hand');
  perform app.notify(ws, olga, 'daily', 'Hello Olga', '/note-test-a');
  perform app.notify(ws, sam, 'daily', 'Hello Sam', '/note-test-a');
  perform app.notify(ws, eve, 'daily', 'Eve is not a member of A', '/note-test-a');
  select count(*) into n from public.notifications where workspace_id = ws;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' only members are notified (' || n || ')');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$select 1 from public.notifications where workspace_id = '%s'$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' a person sees only their own notifications');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select 1 from public.notifications where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' another business sees none of them');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$update public.notifications set read_at = now() where workspace_id = '%s'$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' they can mark their own as read, and only their own');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$update public.notifications set title = 'changed' where workspace_id = '%s'$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' but not change what they say');

  -- preferences switch a kind off
  insert into public.notification_prefs (user_id, kind, enabled, push) values (sam, 'daily', false, false);
  perform app.notify(ws, sam, 'daily', 'Second hello', '/note-test-a', 'k2');
  select count(*) into n from public.notifications where user_id = sam;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a kind a person switched off is not delivered (' || n || ')');
  perform app.notify(ws, olga, 'daily', 'Once a day', '/note-test-a', 'daily:2026-11-14');
  perform app.notify(ws, olga, 'daily', 'Once a day', '/note-test-a', 'daily:2026-11-14');
  select count(*) into n from public.notifications where user_id = olga and dedupe_key = 'daily:2026-11-14';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the same dedupe key notifies once (' || n || ')');

  -- events
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'invoice', c) returning id into inv;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, inv, 1, 'Job', 1, 100000, 0);
  update public.sales_documents set status = 'sent', number = 'INV-0001', due_date = current_date + 7 where id = inv;
  delete from public.notifications;
  perform set_config('request.jwt.claims', json_build_object('sub', olga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.record_manual_payment(inv, 40000, 'cash', null, 'cash', null, gen_random_uuid());
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select string_agg(user_id::text || ':' || kind, ',') into t from public.notifications where workspace_id = ws;
  r := r || (case when t = olga::text || ':payment' then 'PASS' else 'FAIL' end || ' a payment notifies the owner (and not staff) (' || coalesce(t, 'none') || ')');
  select title into t from public.notifications where kind = 'payment';
  r := r || (case when t like '%R400.00%' and t like '%INV-0001%' then 'PASS' else 'FAIL' end || ' naming the amount and invoice (' || coalesce(t, '') || ')');
  select href into t from public.notifications where kind = 'payment';
  r := r || (case when t = '/note-test-a/money/' || inv then 'PASS' else 'FAIL' end || ' and linking to it');

  delete from public.notifications;
  select public_token into tok from public.sales_documents where id = inv;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  perform public.mark_document_viewed(tok);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.notifications where kind = 'invoice_viewed' and user_id = olga;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the client opening an invoice notifies the owner');

  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'quote', c) returning id into quote;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, quote, 1, 'Quote', 1, 50000, 0);
  update public.sales_documents set status = 'sent', number = 'QUO-0001' where id = quote;
  delete from public.notifications;
  update public.sales_documents set status = 'accepted', accepted_at = now() where id = quote;
  select count(*) into n from public.notifications where kind = 'quote_accepted' and user_id = olga;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a quote accepted notifies the owner');

  insert into public.services (workspace_id, name, duration_min) values (ws, 'Cut', 30) returning id into svc;
  delete from public.notifications;
  insert into public.bookings (workspace_id, service_id, starts_at, ends_at, blocked_until, customer_name, customer_email, token)
  values (ws, svc, now() + interval '2 days', now() + interval '2 days 30 minutes', now() + interval '2 days 30 minutes', 'Lerato', 'l@x.test', repeat('a', 32));
  select count(*) into n from public.notifications where kind = 'booking' and user_id = olga;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a new booking notifies the owner');

  insert into public.products (workspace_id, name, track_stock, reorder_level) values (ws, 'Tile', true, 5) returning id into prod;
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values (ws, prod, 10, 'initial');
  delete from public.notifications;
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values (ws, prod, -3, 'adjustment');
  select count(*) into n from public.notifications where kind = 'low_stock';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' stock still above the re-order level says nothing');
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values (ws, prod, -3, 'adjustment');
  select count(*) into n from public.notifications where kind = 'low_stock' and user_id = olga;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' falling to the re-order level notifies the owner');
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values (ws, prod, -1, 'adjustment');
  select count(*) into n from public.notifications where kind = 'low_stock';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and only on the way down, not at every sale');

  insert into public.projects (workspace_id, name) values (ws, 'P') returning id into proj;
  delete from public.notifications;
  insert into public.tasks (workspace_id, project_id, title, assignee_id) values (ws, proj, 'Measure', sam) returning id into task;
  select count(*) into n from public.notifications where kind = 'task_assigned' and user_id = sam;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a task given to someone notifies them');
  delete from public.notifications;
  update public.tasks set title = 'Measure twice' where id = task;
  select count(*) into n from public.notifications;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' editing it does not');
  update public.tasks set assignee_id = olga where id = task;
  select count(*) into n from public.notifications where kind = 'task_assigned' and user_id = olga;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' reassigning it notifies the new person');

  -- the daily reminder
  delete from public.notifications;
  update public.sales_documents set due_date = current_date - 5 where id = inv;
  perform app.daily_reminders();
  perform app.daily_reminders();
  select count(*) into n from public.notifications where kind = 'daily' and user_id = olga;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the owner gets one daily reminder a day (' || n || ')');
  select title into t from public.notifications where kind = 'daily' and user_id = olga;
  r := r || (case when t like '%1 overdue invoice%' then 'PASS' else 'FAIL' end || ' that counts the overdue invoice (' || coalesce(t, '') || ')');
  select count(*) into n from public.notifications where kind = 'daily' and user_id = sam;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' and staff do not get the money summary');
  update public.sales_documents set due_date = current_date + 7 where id = inv;
  delete from public.notifications;
  update public.tasks set status = 'done' where workspace_id = ws;
  perform app.daily_reminders();
  select count(*) into n from public.notifications where kind = 'daily';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a quiet day sends nothing');
  insert into public.notifications (workspace_id, user_id, kind, title, created_at) values (ws, olga, 'daily', 'Ancient', now() - interval '40 days');
  perform app.daily_reminders();
  select count(*) into n from public.notifications where title = 'Ancient';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' notifications older than 30 days are purged');

  -- push: subscriptions are private, delivery is claimed once and only for people who want it
  r := r || (case when pg_temp.probe('authenticated', olga, $q$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'https://push.example/olga', 'k', 'a')$q$) = 1 then 'PASS' else 'FAIL' end || ' a person can save their own push subscription');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('%s', 'https://push.example/for-sam', 'k', 'a')$q$, sam)) = -1 then 'PASS' else 'FAIL' end || ' but not for someone else');
  r := r || (case when pg_temp.probe('authenticated', sam, $q$select 1 from public.push_subscriptions$q$) = 0 then 'PASS' else 'FAIL' end || ' nobody else can read it');
  r := r || (case when pg_temp.probe('authenticated', olga, $q$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'http://insecure.example/x', 'k', 'a')$q$) = -1 then 'PASS' else 'FAIL' end || ' and the endpoint must be https');
  delete from public.notifications;
  perform app.notify(ws, olga, 'payment', 'Pay 1', '/x');
  perform app.notify(ws, sam, 'payment', 'Pay for Sam, who has no subscription', '/x');
  select count(*) into n from public.claim_push(10);
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' only people with a subscription are pushed (' || n || ')');
  select count(*) into n from public.claim_push(10);
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' and each notification is pushed once');
  insert into public.notification_prefs (user_id, kind, enabled, push) values (olga, 'booking', true, false);
  perform app.notify(ws, olga, 'booking', 'Booked', '/x');
  select count(*) into n from public.claim_push(10);
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' push switched off for a kind is not pushed');
  r := r || (case when pg_temp.probe('authenticated', olga, $q$select * from public.claim_push(10)$q$) = -1 then 'PASS' else 'FAIL' end || ' signed-in users cannot claim pushes');
  perform public.drop_push_subscription('https://push.example/olga');
  select count(*) into n from public.push_subscriptions;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a gone subscription (404/410) can be removed by the server');
  r := r || (case when pg_temp.probe('anon', null, $q$select public.drop_push_subscription('x')$q$) = -1 then 'PASS' else 'FAIL' end || ' but not by the public');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'NOTIFICATION TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
