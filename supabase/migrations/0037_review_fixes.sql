-- 0037_review_fixes: fixes from the independent Phase 6 review.
-- Down script: supabase/migrations/down/0037_review_fixes.sql
--
-- 1. AI allowance functions are for the server only. Any signed-in person could call ai_take / ai_release
--    straight over the API and (a) burn the whole service's daily cap without using a request, or
--    (b) release a successful request and ask again past their monthly limit.
-- 2. A push subscription moves to whoever subscribes on that device (a shared phone no longer keeps the last person's alerts).
-- 3. The daily 08:00 summary is one per business, not one per person per day.
-- 4. Automations: "overdue" means after the due date; a rule only acts on records that become eligible from the day
--    it is made (no email to every old debtor at once); client emails go out between 08:00 and 17:00 SAST only;
--    the run log never shows raw database errors.

-- ---------------------------------------------------------------------------
-- 1. AI: server only
-- ---------------------------------------------------------------------------
drop function if exists public.ai_take(uuid, text);
drop function if exists public.ai_release(uuid);

create function public.ai_take(p_workspace uuid, p_user uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled boolean;
  ws_plan text;
  lim integer;
  month_start timestamptz := date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
  used integer;
  g integer;
  new_id uuid;
begin
  if p_user is null or not exists (select 1 from public.memberships m where m.workspace_id = p_workspace and m.user_id = p_user) then
    raise exception 'Business not found' using errcode = 'no_data_found';
  end if;
  if p_kind is null or p_kind not in ('chat', 'receipt', 'summary') then
    raise exception 'Unknown request' using errcode = 'LDG03';
  end if;
  select s.ai_enabled, w.plan into enabled, ws_plan
  from public.workspace_settings s join public.workspaces w on w.id = s.workspace_id where s.workspace_id = p_workspace;
  if not coalesce(enabled, false) then
    raise exception 'The AI helper is switched off for this business. An owner can switch it on in Settings.' using errcode = 'LDG03';
  end if;
  lim := case ws_plan when 'pro' then 300 else 20 end;
  perform pg_advisory_xact_lock(hashtext('ai:' || p_workspace::text));
  select count(*) into used from public.ai_usage where workspace_id = p_workspace and created_at >= month_start;
  if used >= lim then
    raise exception 'You have used all % AI requests for this month. They reset on the 1st.', lim using errcode = 'LDG01';
  end if;
  insert into public.ai_global_daily as d (day, requests) values (app.sast_today(), 1)
  on conflict (day) do update set requests = d.requests + 1 where d.requests < 1000
  returning requests into g;
  if g is null then
    raise exception 'The AI helper is very busy today. Please try again tomorrow.' using errcode = 'LDG01';
  end if;
  insert into public.ai_usage (workspace_id, user_id, kind) values (p_workspace, p_user, p_kind) returning id into new_id;
  return jsonb_build_object('used', used + 1, 'limit', lim, 'usage_id', new_id);
end;
$$;

-- Gives a request back after the provider failed: only its own maker, only soon after, and the service-wide count too.
create function public.ai_release(p_id uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.ai_usage where id = p_id and user_id = p_user and created_at > now() - interval '15 minutes'
    returning (created_at at time zone 'Africa/Johannesburg')::date as day
  )
  update public.ai_global_daily d set requests = greatest(d.requests - 1, 0) from gone where d.day = gone.day;
$$;

revoke all on function public.ai_take(uuid, uuid, text), public.ai_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_take(uuid, uuid, text), public.ai_release(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Push: a subscription belongs to whoever subscribes on that device
-- ---------------------------------------------------------------------------
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'no_data_found';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Daily summary: one per business
-- ---------------------------------------------------------------------------
create or replace function app.daily_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := app.sast_today();
  w record;
  overdue integer;
  tasks integer;
  made integer := 0;
  title text;
begin
  delete from public.notifications where created_at < now() - interval '30 days';
  for w in select id, slug from public.workspaces where deleted_at is null loop
    select count(*) into overdue from public.sales_documents d
    where d.workspace_id = w.id and d.kind = 'invoice' and d.status in ('sent', 'viewed', 'part_paid')
      and d.due_date < today and d.total_cents - d.paid_cents - d.credited_cents > 0;
    select count(*) into tasks from public.tasks t
    where t.workspace_id = w.id and t.status <> 'done' and t.due_date <= today;
    if overdue + tasks > 0 then
      title := 'Today: ' || array_to_string(array_remove(array[
        case when overdue > 0 then overdue || ' overdue invoice' || case when overdue = 1 then '' else 's' end end,
        case when tasks > 0 then tasks || ' task' || case when tasks = 1 then '' else 's' end || ' due' end], null), ' and ');
      perform app.notify_roles(w.id, array['owner', 'admin'], 'daily', title, '/' || w.slug, 'daily:' || w.id || ':' || today);
      made := made + 1;
    end if;
  end loop;
  return made;
end;
$$;
revoke all on function app.daily_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Automations
-- ---------------------------------------------------------------------------
drop function if exists app.rule_matches(uuid, text, integer, timestamptz, date);

-- `since` is the day the rule was made: a record only matches if it became eligible on or after that day.
create function app.rule_matches(ws uuid, trig text, th integer, p_now timestamptz, today date, since date)
returns table (ref_key text, label text, href text, email text, late integer, task_title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  slug text := app.ws_slug(ws);
  n integer := greatest(th, 1);  -- "overdue" and "unanswered" always mean at least one day
begin
  if trig = 'invoice_overdue' then
    return query
      select d.id::text, d.number, '/' || slug || '/money/' || d.id, lower(c.email), (today - d.due_date)::int, 'Chase invoice ' || d.number
      from public.sales_documents d join public.contacts c on c.id = d.contact_id and c.workspace_id = d.workspace_id and c.deleted_at is null
      where d.workspace_id = ws and d.kind = 'invoice' and d.status in ('sent', 'viewed', 'part_paid')
        and d.total_cents - d.paid_cents - d.credited_cents > 0
        and d.due_date <= today - n and d.due_date + n >= since
      order by d.due_date limit 200;
  elsif trig = 'quote_unaccepted' then
    return query
      select d.id::text, d.number, '/' || slug || '/money/' || d.id, lower(c.email), extract(day from p_now - d.sent_at)::int, 'Follow up quote ' || d.number
      from public.sales_documents d join public.contacts c on c.id = d.contact_id and c.workspace_id = d.workspace_id and c.deleted_at is null
      where d.workspace_id = ws and d.kind = 'quote' and d.status in ('sent', 'viewed')
        and d.sent_at <= p_now - make_interval(days => n)
        and (d.sent_at at time zone 'Africa/Johannesburg')::date + n >= since
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
      where t.workspace_id = ws and t.status <> 'done' and t.due_date is not null
        and t.due_date <= today - n and t.due_date + n >= since
      order by t.due_date limit 200;
  end if;
end;
$$;
revoke all on function app.rule_matches(uuid, text, integer, timestamptz, date, date) from public, anon, authenticated;

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
  hour_now integer := extract(hour from p_now at time zone 'Africa/Johannesburg')::int;
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
    -- Emails to clients only go out in working hours (SAST); the rule simply waits for the next hour that is.
    if rl.action = 'send_reminder' and hour_now not between 8 and 16 then
      continue;
    end if;
    for m in select * from app.rule_matches(rl.workspace_id, rl.trigger, rl.threshold, p_now, today, (rl.created_at at time zone 'Africa/Johannesburg')::date) loop
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
        -- Never show raw database text: it can name tables and columns.
        update public.automation_runs set outcome = 'failed', detail = 'Something went wrong with this one' where id = claimed;
      end;
    end loop;
  end loop;
  return fired;
end;
$$;
revoke all on function app.evaluate_rules(timestamptz) from public, anon, authenticated;
