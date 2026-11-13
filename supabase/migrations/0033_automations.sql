-- 0033_automations: fixed trigger → action rules, an hourly evaluator, a run log, and the push schedule.
-- Down script: supabase/migrations/down/0033_automations.sql
--
-- Rules the database enforces:
--  * Only owners and admins make rules, and only combinations that make sense (a task cannot email a client).
--  * A rule fires once per matching record, never once per run: `automation_runs` is unique on (rule, record),
--    claimed before the action is taken. Disabled rules never fire. Failures are logged, not retried.
--  * Only the scheduler runs the evaluator.

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  trigger text not null check (trigger in ('invoice_overdue', 'quote_unaccepted', 'stock_below', 'booking_soon', 'task_overdue')),
  -- Days (hours for booking_soon). Not used by stock_below.
  threshold smallint not null default 0 check (threshold between 0 and 365),
  action text not null check (action in ('send_reminder', 'notify_me', 'create_task')),
  enabled boolean not null default true,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (
    (trigger in ('invoice_overdue', 'quote_unaccepted') and action in ('send_reminder', 'notify_me', 'create_task'))
    or (trigger in ('stock_below', 'booking_soon') and action in ('notify_me', 'create_task'))
    or (trigger = 'task_overdue' and action = 'notify_me')
  ),
  check (trigger <> 'booking_soon' or threshold between 1 and 168)
);
create index automation_rules_ws_idx on public.automation_rules (workspace_id, created_at);
create index automation_rules_created_by_idx on public.automation_rules (created_by);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  rule_id uuid not null,
  ref_key text not null check (char_length(ref_key) between 1 and 120),
  outcome text not null check (outcome in ('done', 'failed')),
  detail text check (char_length(detail) <= 300),
  created_at timestamptz not null default now(),
  unique (rule_id, ref_key),
  foreign key (workspace_id, rule_id) references public.automation_rules (workspace_id, id) on delete cascade
);
create index automation_runs_ws_idx on public.automation_runs (workspace_id, created_at desc);

create trigger touch_automation_rules before update on public.automation_rules for each row execute function app.touch_updated_at();
create trigger fixed_ws_automation_rules before update on public.automation_rules for each row execute function app.forbid_workspace_change();

create or replace function app.guard_rule_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.automation_rules where workspace_id = new.workspace_id) >= 25 then
    raise exception 'You can have up to 25 automation rules.' using errcode = 'LDG03';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_count() from public, anon, authenticated;
create trigger guard_rule_count before insert on public.automation_rules for each row execute function app.guard_rule_count();

alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
revoke all on public.automation_rules, public.automation_runs from anon, authenticated;
grant select on public.automation_rules, public.automation_runs to authenticated;
grant insert (workspace_id, name, trigger, threshold, action, enabled) on public.automation_rules to authenticated;
grant update (name, threshold, enabled) on public.automation_rules to authenticated;
grant delete on public.automation_rules to authenticated;

create policy automation_rules_select on public.automation_rules for select to authenticated using ((select app.is_member(workspace_id)));
create policy automation_rules_insert on public.automation_rules for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy automation_rules_update on public.automation_rules for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy automation_rules_delete on public.automation_rules for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy automation_runs_select on public.automation_runs for select to authenticated using ((select app.is_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- What each trigger matches (at most 200 records per rule per run)
-- ---------------------------------------------------------------------------
create or replace function app.rule_matches(ws uuid, trig text, th integer, p_now timestamptz, today date)
returns table (ref_key text, label text, href text, email text, late integer, task_title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  slug text := app.ws_slug(ws);
begin
  if trig = 'invoice_overdue' then
    return query
      select d.id::text, d.number, '/' || slug || '/money/' || d.id, lower(c.email), (today - d.due_date)::int, 'Chase invoice ' || d.number
      from public.sales_documents d join public.contacts c on c.id = d.contact_id and c.workspace_id = d.workspace_id and c.deleted_at is null
      where d.workspace_id = ws and d.kind = 'invoice' and d.status in ('sent', 'viewed', 'part_paid')
        and d.total_cents - d.paid_cents - d.credited_cents > 0 and d.due_date <= today - th
      order by d.due_date limit 200;
  elsif trig = 'quote_unaccepted' then
    return query
      select d.id::text, d.number, '/' || slug || '/money/' || d.id, lower(c.email), extract(day from p_now - d.sent_at)::int, 'Follow up quote ' || d.number
      from public.sales_documents d join public.contacts c on c.id = d.contact_id and c.workspace_id = d.workspace_id and c.deleted_at is null
      where d.workspace_id = ws and d.kind = 'quote' and d.status in ('sent', 'viewed') and d.sent_at <= p_now - make_interval(days => th)
      order by d.sent_at limit 200;
  elsif trig = 'stock_below' then
    return query
      select p.id || ':' || coalesce(extract(epoch from (select max(m.created_at) from public.stock_movements m where m.product_id = p.id and m.reason = 'purchase'))::bigint, 0),
             p.name || ' is running low (' || trim(trailing '.' from trim(trailing '0' from p.stock_qty::text)) || ' left)',
             '/' || slug || '/stock/' || p.id, null::text, 0, 'Re-order ' || p.name
      from public.products p
      where p.workspace_id = ws and p.deleted_at is null and p.track_stock and p.reorder_level > 0 and p.stock_qty <= p.reorder_level
      order by p.name limit 200;
  elsif trig = 'booking_soon' then
    return query
      select b.id::text, b.customer_name || ' at ' || to_char(b.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI'),
             '/' || slug || '/work/bookings', null::text, 0, 'Prepare for booking: ' || b.customer_name
      from public.bookings b
      where b.workspace_id = ws and b.status = 'confirmed' and b.starts_at > p_now and b.starts_at <= p_now + make_interval(hours => th)
      order by b.starts_at limit 200;
  elsif trig = 'task_overdue' then
    return query
      select t.id::text, t.title, '/' || slug || '/work/tasks/' || t.id, null::text, (today - t.due_date)::int, t.title
      from public.tasks t
      where t.workspace_id = ws and t.status <> 'done' and t.due_date is not null and t.due_date <= today - th
      order by t.due_date limit 200;
  end if;
end;
$$;
revoke all on function app.rule_matches(uuid, text, integer, timestamptz, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The evaluator (hourly): returns how many times a rule fired
-- ---------------------------------------------------------------------------
create or replace function app.evaluate_rules(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rl record;
  m record;
  today date := (p_now at time zone 'Africa/Johannesburg')::date;
  fired integer := 0;
  claimed uuid;
  title text;
  note text;
  reply text;
  days_word text;
begin
  for rl in
    select r.* from public.automation_rules r
    join public.workspaces w on w.id = r.workspace_id and w.deleted_at is null
    where r.enabled order by r.created_at
  loop
    for m in select * from app.rule_matches(rl.workspace_id, rl.trigger, rl.threshold, p_now, today) loop
      -- Claim the record first: a second run (or a concurrent one) finds the row and skips it.
      insert into public.automation_runs (workspace_id, rule_id, ref_key, outcome)
      values (rl.workspace_id, rl.id, m.ref_key, 'done')
      on conflict (rule_id, ref_key) do nothing
      returning id into claimed;
      if claimed is null then
        continue;
      end if;
      days_word := m.late || ' day' || case when m.late = 1 then '' else 's' end;
      begin
        if rl.action = 'notify_me' then
          title := case rl.trigger
            when 'invoice_overdue' then 'Invoice ' || m.label || ' is ' || days_word || ' overdue'
            when 'quote_unaccepted' then 'Quote ' || m.label || ' has had no answer for ' || days_word
            when 'booking_soon' then 'Booking soon: ' || m.label
            when 'task_overdue' then 'Task overdue: ' || m.label
            else m.label end;
          perform app.notify_roles(rl.workspace_id, array['owner', 'admin'], 'automation', left(title, 160), m.href, 'auto:' || rl.id || ':' || m.ref_key);
          update public.automation_runs set detail = 'Owners and admins notified' where id = claimed;
        elsif rl.action = 'create_task' then
          insert into public.tasks (workspace_id, title, notes, due_date)
          values (rl.workspace_id, left(m.task_title, 200), 'Made by your automation "' || rl.name || '".', today);
          update public.automation_runs set detail = 'Task created' where id = claimed;
        else
          if m.email is null or m.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
            update public.automation_runs set outcome = 'failed', detail = 'This client has no email address' where id = claimed;
            continue;
          end if;
          select lower(u.email) into reply from public.memberships mb join auth.users u on u.id = mb.user_id
          where mb.workspace_id = rl.workspace_id and mb.role = 'owner' order by mb.created_at limit 1;
          note := case rl.trigger
            when 'invoice_overdue' then 'Invoice ' || m.label || ' is ' || days_word || ' overdue. If you have already paid, thank you, and please ignore this.'
            else 'A friendly follow-up on quote ' || m.label || ', sent ' || days_word || ' ago. Let us know if you have any questions.' end;
          insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key)
          values (rl.workspace_id, 'reminder', m.email, reply, jsonb_build_object('document_id', m.ref_key::uuid, 'message', note),
                  'automation:' || rl.id || ':' || m.ref_key)
          on conflict (idempotency_key) do nothing;
          update public.automation_runs set detail = 'Reminder emailed to the client' where id = claimed;
        end if;
        fired := fired + 1;
      exception when others then
        update public.automation_runs set outcome = 'failed', detail = left(sqlerrm, 300) where id = claimed;
      end;
    end loop;
  end loop;
  return fired;
end;
$$;
revoke all on function app.evaluate_rules(timestamptz) from public, anon, authenticated;
select cron.schedule('automations-hourly', '5 * * * *', $cron$select app.evaluate_rules(now())$cron$);

-- ---------------------------------------------------------------------------
-- The push job runs only when something is waiting
-- ---------------------------------------------------------------------------
create or replace function app.call_job(job text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if job = 'outbox' and not exists (
    select 1 from public.outbox where status = 'pending' and next_attempt_at <= now()
  ) and not exists (
    select 1 from public.outbox where status = 'sending' and next_attempt_at < now() - interval '10 minutes'
  ) then
    return;
  end if;
  if job = 'push' and not exists (
    select 1 from public.notifications n
    where n.pushed_at is null and n.created_at > now() - interval '1 hour'
      and exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
  ) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'site_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'jobs_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url || '/api/jobs/' || job,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000);
end;
$$;
revoke all on function app.call_job(text) from public, anon, authenticated;
select cron.schedule('push-every-minute', '* * * * *', $cron$select app.call_job('push')$cron$);
