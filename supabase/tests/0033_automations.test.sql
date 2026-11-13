-- Tests for 0033_automations. Ends by raising "AUTOMATION TESTS: n passed, m failed" (rolls back).
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

-- Rules act only on records that become eligible from the day the rule is made (0037), so these tests make the rule
-- "old" first; the new behaviour itself is tested in 0037_review_fixes.test.sql.
create function pg_temp.run(p_now timestamptz) returns integer language plpgsql as $f$
begin
  update public.automation_rules set created_at = least(created_at, now() - interval '90 days');
  return app.evaluate_rules(p_now);
end
$f$;
-- 10:00 SAST today: client emails only go out in working hours.
create function pg_temp.ten() returns timestamptz language sql as $f$
  select ((now() at time zone 'Africa/Johannesburg')::date::timestamp + interval '10 hours') at time zone 'Africa/Johannesburg'
$f$;

-- A sent invoice with one R1 000 line, due `due`.
create function pg_temp.mkinv(ws uuid, c uuid, num text, st text, due date) returns uuid language plpgsql as $f$
declare d uuid;
begin
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'invoice', c) returning id into d;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, d, 1, 'Job', 1, 100000, 0);
  update public.sales_documents set status = st, number = num, due_date = due, sent_at = now() - interval '30 days' where id = d;
  return d;
end
$f$;

do $$
declare
  r text[] := '{}';
  n int; t text; fired int;
  olga uuid := gen_random_uuid(); adam uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); eve uuid := gen_random_uuid();
  ws uuid; ws2 uuid; c uuid; c_noemail uuid; c2 uuid; inv uuid; inv_paid uuid; inv_new uuid; inv_noemail uuid; q_old uuid; q_acc uuid;
  prod uuid; svc uuid; proj uuid; rule uuid; rule2 uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (olga, 'olga@auto.test'), (adam, 'adam@auto.test'), (sam, 'sam@auto.test'), (acc, 'acc@auto.test'), (eve, 'eve@auto.test');
  insert into public.workspaces (slug, name, created_by, plan) values ('auto-test-a', 'A', olga, 'pro') returning id into ws;
  insert into public.workspaces (slug, name, created_by, plan) values ('auto-test-b', 'B', eve, 'pro') returning id into ws2;
  insert into public.memberships (workspace_id, user_id, role) values (ws, olga, 'owner'), (ws, adam, 'admin'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws2, eve, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws2);
  insert into public.contacts (workspace_id, name, email) values (ws, 'Thandi', 'thandi@client.test') returning id into c;
  insert into public.contacts (workspace_id, name) values (ws, 'No Email') returning id into c_noemail;
  insert into public.contacts (workspace_id, name, email) values (ws2, 'Eve client', 'ec@client.test') returning id into c2;

  -- who may manage rules
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values ('%s','x','invoice_overdue',3,'notify_me')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' staff cannot make rules');
  r := r || (case when pg_temp.probe('authenticated', acc, format($q$insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values ('%s','x','invoice_overdue',3,'notify_me')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' nor the accountant');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values ('%s','x','invoice_overdue',3,'notify_me')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' nor another business');
  r := r || (case when pg_temp.probe('authenticated', adam, format($q$insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values ('%s','Chase late invoices','invoice_overdue',3,'notify_me')$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' an admin can');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select 1 from public.automation_rules where workspace_id = '%s'$q$, ws)) = 1 then 'PASS' else 'FAIL' end || ' everyone on the team can read them');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select 1 from public.automation_rules where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' another business cannot');
  delete from public.automation_rules;
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values ('%s','x','task_overdue',1,'send_reminder')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' a rule must be a combination that makes sense (a task cannot send a client reminder)');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values ('%s','x','booking_soon',200,'notify_me')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' a booking alert is at most a week ahead');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values ('%s','x','invoice_overdue',-1,'notify_me')$q$, ws)) = -1 then 'PASS' else 'FAIL' end || ' and days cannot be negative');

  -- invoices: due long ago, due recently, paid, draft, and a client with no email
  inv := pg_temp.mkinv(ws, c, 'INV-0001', 'sent', current_date - 5);
  inv_new := pg_temp.mkinv(ws, c, 'INV-0002', 'sent', current_date - 2);
  inv_paid := pg_temp.mkinv(ws, c, 'INV-0003', 'paid', current_date - 9);
  inv_noemail := pg_temp.mkinv(ws, c_noemail, 'INV-0004', 'sent', current_date - 8);
  insert into public.sales_documents (workspace_id, kind, contact_id, due_date) values (ws, 'invoice', c, current_date - 20);
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action, created_by) values (ws, 'Tell me about late invoices', 'invoice_overdue', 3, 'notify_me', olga) returning id into rule;
  delete from public.notifications;

  fired := pg_temp.run(now());
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' "notify me" fires for each overdue invoice past 3 days, not for newer, paid or draft ones (' || n || ')');
  select count(*) into n from public.notifications where kind = 'automation' and user_id in (sam, acc);
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' and only owners and admins are told');
  select title into t from public.notifications where kind = 'automation' and user_id = olga and title like '%INV-0001%';
  r := r || (case when t like '%5 days overdue%' then 'PASS' else 'FAIL' end || ' naming the invoice and how late it is (' || coalesce(t, 'none') || ')');
  perform pg_temp.run(now());
  perform pg_temp.run(now() + interval '1 hour');
  perform pg_temp.run(now() + interval '2 hours');
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' running again, hours later, fires nothing new: once per record, not once per run (' || n || ')');
  select count(*) into n from public.automation_runs where rule_id = rule and outcome = 'done';
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' and each firing is in the run log (' || n || ')');
  r := r || (case when pg_temp.probe('authenticated', sam, format($q$select 1 from public.automation_runs where workspace_id = '%s'$q$, ws)) = 2 then 'PASS' else 'FAIL' end || ' which the whole team can read');
  r := r || (case when pg_temp.probe('authenticated', eve, format($q$select 1 from public.automation_runs where workspace_id = '%s'$q$, ws)) = 0 then 'PASS' else 'FAIL' end || ' but another business cannot');
  r := r || (case when pg_temp.probe('authenticated', olga, format($q$insert into public.automation_runs (workspace_id, rule_id, ref_key, outcome) values ('%s','%s','x','done')$q$, ws, rule)) = -1 then 'PASS' else 'FAIL' end || ' and nobody can write to it');
  r := r || (case when pg_temp.probe('authenticated', olga, 'select app.evaluate_rules(now())') = -1 then 'PASS' else 'FAIL' end || ' only the scheduler can run the rules');

  -- a disabled rule never fires; switching it on does
  update public.automation_rules set enabled = false where id = rule;
  delete from public.automation_runs; delete from public.notifications;
  perform pg_temp.run(now());
  select count(*) into n from public.notifications;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a disabled rule never fires');
  update public.automation_rules set enabled = true where id = rule;
  perform pg_temp.run(now());
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga;
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' and fires once it is switched on');

  -- send a reminder to the client, through the outbox
  update public.automation_rules set enabled = false where id = rule;
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Email late payers', 'invoice_overdue', 3, 'send_reminder') returning id into rule2;
  delete from public.outbox;
  perform pg_temp.run(pg_temp.ten());
  perform pg_temp.run(pg_temp.ten());
  select count(*) into n from public.outbox where workspace_id = ws and template = 'reminder' and to_address = 'thandi@client.test' and payload ->> 'document_id' = inv::text;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a reminder is queued once to the client (' || n || ')');
  select payload ->> 'message' into t from public.outbox where payload ->> 'document_id' = inv::text;
  r := r || (case when t like '%INV-0001%' and t like '%5 days%' then 'PASS' else 'FAIL' end || ' saying which invoice and how late (' || coalesce(t, '') || ')');
  select detail into t from public.automation_runs where rule_id = rule2 and ref_key = inv_noemail::text;
  r := r || (case when t like '%no email%' then 'PASS' else 'FAIL' end || ' a client with no email address is logged as failed, and not retried (' || coalesce(t, 'none') || ')');
  select count(*) into n from public.automation_runs where rule_id = rule2 and outcome = 'failed';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' once');
  select count(*) into n from public.outbox where workspace_id = ws2;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' and nothing is queued for another business');

  -- create a task
  update public.automation_rules set enabled = false where id = rule2;
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Task to chase', 'invoice_overdue', 7, 'create_task');
  perform pg_temp.run(now());
  perform pg_temp.run(now());
  select count(*) into n from public.tasks where workspace_id = ws and title = 'Chase invoice INV-0004';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' "create task" makes one task for the invoice past 7 days (' || n || ')');
  select count(*) into n from public.tasks where workspace_id = ws and title like 'Chase invoice%';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and not for ones that are not late enough');
  delete from public.automation_rules where workspace_id = ws;

  -- quotes nobody answered
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'quote', c) returning id into q_old;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, q_old, 1, 'Q', 1, 50000, 0);
  update public.sales_documents set status = 'sent', number = 'QUO-0001', sent_at = now() - interval '10 days' where id = q_old;
  insert into public.sales_documents (workspace_id, kind, contact_id) values (ws, 'quote', c) returning id into q_acc;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate) values (ws, q_acc, 1, 'Q', 1, 50000, 0);
  update public.sales_documents set status = 'accepted', number = 'QUO-0002', sent_at = now() - interval '10 days' where id = q_acc;
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Nudge quotes', 'quote_unaccepted', 7, 'notify_me');
  delete from public.notifications;
  perform pg_temp.run(now());
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga and title like '%QUO-0001%';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' an unanswered quote after 7 days fires');
  select count(*) into n from public.notifications where kind = 'automation' and title like '%QUO-0002%';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' an accepted one does not');
  delete from public.automation_rules where workspace_id = ws;

  -- low stock, again after a restock
  insert into public.products (workspace_id, name, track_stock, reorder_level) values (ws, 'Tile', true, 5) returning id into prod;
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values (ws, prod, 4, 'initial');
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Stock alert', 'stock_below', 0, 'notify_me');
  delete from public.notifications;
  perform pg_temp.run(now());
  perform pg_temp.run(now());
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga and title like '%Tile%';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a product at its re-order level fires once');
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason, line_id) values (ws, prod, 20, 'purchase', gen_random_uuid());
  perform pg_temp.run(now());
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga and title like '%Tile%';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' and stays quiet while stock is healthy');
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason) values (ws, prod, -20, 'adjustment');
  perform pg_temp.run(now() + interval '1 second');
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga and title like '%Tile%';
  r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' but fires again after a restock and a new fall (' || n || ')');
  delete from public.automation_rules where workspace_id = ws;

  -- a booking coming up, and an overdue task
  insert into public.services (workspace_id, name, duration_min) values (ws, 'Cut', 30) returning id into svc;
  insert into public.bookings (workspace_id, service_id, starts_at, ends_at, blocked_until, customer_name, customer_email, token) values
    (ws, svc, now() + interval '5 hours', now() + interval '5 hours 30 minutes', now() + interval '5 hours 30 minutes', 'Soon Sam', 's@x.test', repeat('b', 32)),
    (ws, svc, now() + interval '3 days', now() + interval '3 days 30 minutes', now() + interval '3 days 30 minutes', 'Later Lee', 'l@x.test', repeat('c', 32));
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Booking soon', 'booking_soon', 24, 'notify_me');
  insert into public.projects (workspace_id, name) values (ws, 'P') returning id into proj;
  insert into public.tasks (workspace_id, project_id, title, due_date, status) values (ws, proj, 'Late job', current_date - 2, 'todo'), (ws, proj, 'Done job', current_date - 2, 'done'), (ws, proj, 'Future job', current_date + 2, 'todo');
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws, 'Overdue tasks', 'task_overdue', 0, 'notify_me');
  delete from public.notifications;
  perform pg_temp.run(now());
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga and title like '%Soon Sam%';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a booking within 24 hours fires');
  select count(*) into n from public.notifications where kind = 'automation' and title like '%Later Lee%';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' one three days away does not');
  select count(*) into n from public.notifications where kind = 'automation' and user_id = olga and title like '%Late job%';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' an overdue open task fires');
  select count(*) into n from public.notifications where kind = 'automation' and (title like '%Done job%' or title like '%Future job%');
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' a finished or future one does not');

  -- rules of one business never touch another
  insert into public.automation_rules (workspace_id, name, trigger, threshold, action) values (ws2, 'B late', 'invoice_overdue', 1, 'notify_me');
  perform pg_temp.mkinv(ws2, c2, 'INV-0001', 'sent', current_date - 4);
  delete from public.notifications;
  perform pg_temp.run(now());
  select count(*) into n from public.notifications where user_id = eve and kind = 'automation';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' another business''s rule fires for its own invoice only');
  select count(*) into n from public.notifications where user_id = olga and title like '%Eve client%';
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' and tells nobody in this one');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'AUTOMATION TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
