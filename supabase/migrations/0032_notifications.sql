-- 0032_notifications: in-app notifications (over Realtime), preferences, web-push subscriptions and the daily reminder.
-- Down script: supabase/migrations/down/0032_notifications.sql
--
-- Rules the database enforces:
--  * Notifications are written only by triggers and functions, never by people; a person reads, marks read and
--    deletes their own. They are published over Realtime, where row-level security still applies.
--  * A person's switched-off kinds are not delivered. The same dedupe key notifies once.
--  * Push is claimed by the server only, once per notification, and only for people who want it.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('payment', 'invoice_viewed', 'quote_accepted', 'booking', 'low_stock', 'task_assigned', 'automation', 'daily')),
  title text not null check (char_length(title) between 1 and 160),
  href text check (href is null or (href like '/%' and char_length(href) <= 300)),
  dedupe_key text check (char_length(dedupe_key) <= 120),
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_ws_idx on public.notifications (workspace_id);
create unique index notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

create table public.notification_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('payment', 'invoice_viewed', 'quote_accepted', 'booking', 'low_stock', 'task_assigned', 'automation', 'daily')),
  enabled boolean not null default true,
  push boolean not null default true,
  primary key (user_id, kind)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 600),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;
revoke all on public.notifications, public.notification_prefs, public.push_subscriptions from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select app.is_member(workspace_id)));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
create policy notification_prefs_all on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.notifications;

-- ---------------------------------------------------------------------------
-- Delivery helpers
-- ---------------------------------------------------------------------------
create or replace function app.ws_slug(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select slug from public.workspaces where id = ws; $$;

create or replace function app.notify(ws uuid, uid uuid, k text, t text, h text, dk text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.memberships m where m.workspace_id = ws and m.user_id = uid) then
    return;
  end if;
  if not coalesce((select p.enabled from public.notification_prefs p where p.user_id = uid and p.kind = k), true) then
    return;
  end if;
  insert into public.notifications (workspace_id, user_id, kind, title, href, dedupe_key)
  values (ws, uid, k, left(t, 160), h, dk)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

create or replace function app.notify_roles(ws uuid, roles text[], k text, t text, h text, dk text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  for m in select user_id from public.memberships where workspace_id = ws and role = any (roles) loop
    perform app.notify(ws, m.user_id, k, t, h, case when dk is null then null else dk end);
  end loop;
end;
$$;
revoke all on function app.ws_slug(uuid), app.notify(uuid, uuid, text, text, text, text), app.notify_roles(uuid, text[], text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What notifies whom
-- ---------------------------------------------------------------------------
create or replace function app.notify_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  num text;
begin
  select number into num from public.sales_documents where id = new.document_id and workspace_id = new.workspace_id;
  perform app.notify_roles(new.workspace_id, array['owner', 'admin'], 'payment',
    'Payment of ' || app.rand(new.amount_cents) || ' received' || coalesce(' for ' || num, ''),
    '/' || app.ws_slug(new.workspace_id) || '/money/' || new.document_id);
  return new;
end;
$$;
create trigger notify_payment after insert on public.payments for each row execute function app.notify_payment();

create or replace function app.notify_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.viewed_at is null and new.viewed_at is not null and new.number is not null then
    perform app.notify_roles(new.workspace_id, array['owner', 'admin'], 'invoice_viewed',
      new.number || ' was opened by the client', '/' || app.ws_slug(new.workspace_id) || '/money/' || new.id);
  end if;
  if new.kind = 'quote' and new.status = 'accepted' and old.status <> 'accepted' then
    perform app.notify_roles(new.workspace_id, array['owner', 'admin'], 'quote_accepted',
      'Quote ' || coalesce(new.number, '') || ' was accepted', '/' || app.ws_slug(new.workspace_id) || '/money/' || new.id);
  end if;
  return new;
end;
$$;
create trigger notify_document after update of viewed_at, status on public.sales_documents
  for each row execute function app.notify_document();

create or replace function app.notify_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify_roles(new.workspace_id, array['owner', 'admin'], 'booking',
    'New booking: ' || new.customer_name || ', ' || to_char(new.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI'),
    '/' || app.ws_slug(new.workspace_id) || '/work/bookings');
  return new;
end;
$$;
create trigger notify_booking after insert on public.bookings for each row execute function app.notify_booking();

-- Only when stock falls through the re-order level, not at every sale below it.
create or replace function app.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
begin
  select * into p from public.products where id = new.product_id and workspace_id = new.workspace_id;
  if p.track_stock and p.reorder_level > 0 and p.stock_qty <= p.reorder_level and p.stock_qty - new.qty_change > p.reorder_level then
    perform app.notify_roles(new.workspace_id, array['owner', 'admin'], 'low_stock',
      p.name || ' is running low (' || trim(trailing '.' from trim(trailing '0' from p.stock_qty::text)) || ' left)',
      '/' || app.ws_slug(new.workspace_id) || '/stock/' || p.id, 'low:' || p.id || ':' || (now() at time zone 'Africa/Johannesburg')::date);
  end if;
  return new;
end;
$$;
create trigger notify_low_stock after insert on public.stock_movements
  for each row when (new.qty_change < 0) execute function app.notify_low_stock();

create or replace function app.notify_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or old.assignee_id is distinct from new.assignee_id)
     and new.assignee_id is distinct from (select auth.uid()) then
    perform app.notify(new.workspace_id, new.assignee_id, 'task_assigned', 'Task for you: ' || new.title,
      '/' || app.ws_slug(new.workspace_id) || '/work/tasks/' || new.id);
  end if;
  return new;
end;
$$;
create trigger notify_task after insert or update of assignee_id on public.tasks for each row execute function app.notify_task();

revoke all on function app.notify_payment(), app.notify_document(), app.notify_booking(), app.notify_low_stock(), app.notify_task()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The daily reminder (08:00 SAST) and housekeeping
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
      perform app.notify_roles(w.id, array['owner', 'admin'], 'daily', title, '/' || w.slug, 'daily:' || today);
      made := made + 1;
    end if;
  end loop;
  return made;
end;
$$;
revoke all on function app.daily_reminders() from public, anon, authenticated;
select cron.schedule('daily-reminders', '0 6 * * *', $cron$select app.daily_reminders()$cron$);

-- ---------------------------------------------------------------------------
-- Web push, for the server's push job only
-- ---------------------------------------------------------------------------
create or replace function public.claim_push(p_limit integer default 50)
returns table (notification_id uuid, user_id uuid, title text, href text, endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select n.id
    from public.notifications n
    where n.pushed_at is null and n.created_at > now() - interval '1 hour'
      and exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
      and coalesce((select p.push from public.notification_prefs p where p.user_id = n.user_id and p.kind = n.kind), true)
    order by n.created_at
    limit least(greatest(p_limit, 1), 200)
    for update skip locked
  ), marked as (
    update public.notifications n set pushed_at = now()
    from picked where n.id = picked.id
    returning n.id, n.user_id, n.title, n.href
  )
  select m.id, m.user_id, m.title, m.href, s.endpoint, s.p256dh, s.auth
  from marked m join public.push_subscriptions s on s.user_id = m.user_id;
$$;

create or replace function public.drop_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.push_subscriptions where endpoint = p_endpoint; $$;

revoke all on function public.claim_push(integer), public.drop_push_subscription(text) from public, anon, authenticated;
grant execute on function public.claim_push(integer), public.drop_push_subscription(text) to service_role;
