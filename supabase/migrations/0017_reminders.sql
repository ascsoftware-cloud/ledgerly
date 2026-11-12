-- 0017_reminders: optional automatic payment reminders, through the same outbox.
-- Off by default: the business decides whether Ledgerly emails its clients.
-- Down: select cron.unschedule('reminders-daily'); drop function public.queue_due_reminders();
--       alter table public.workspace_settings drop column auto_reminders;

alter table public.workspace_settings add column auto_reminders boolean not null default false;
grant update (auto_reminders) on public.workspace_settings to authenticated;


/**
 * Queues reminders for unpaid invoices: 3 days before the due date, on it, and 3 days after.
 * Each reminder has a fixed key per invoice and stage, so running this twice sends nothing new.
 */
create or replace function public.queue_due_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Africa/Johannesburg')::date;
  queued integer;
begin
  with due as (
    select d.id, d.workspace_id, d.number, d.due_date, lower(c.email) as email,
           case
             when d.due_date = today + 3 then 'before'
             when d.due_date = today then 'due'
             when d.due_date = today - 3 then 'after'
           end as stage
    from public.sales_documents d
    join public.contacts c on c.id = d.contact_id
    join public.workspace_settings s on s.workspace_id = d.workspace_id
    join public.workspaces w on w.id = d.workspace_id
    where s.auto_reminders and w.deleted_at is null
      and d.kind = 'invoice' and d.status in ('sent', 'viewed', 'part_paid')
      and d.total_cents - d.paid_cents - d.credited_cents > 0
      and c.email is not null and c.deleted_at is null
      and d.due_date in (today + 3, today, today - 3)
  ), ins as (
    insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key)
    select due.workspace_id, 'reminder', due.email,
           (select lower(u.email) from public.memberships m join auth.users u on u.id = m.user_id
            where m.workspace_id = due.workspace_id and m.role = 'owner' order by m.created_at limit 1),
           jsonb_build_object('document_id', due.id, 'message',
             case due.stage
               when 'before' then 'A friendly reminder that invoice ' || due.number || ' is due on '
                                  || to_char(due.due_date, 'FMDD Mon YYYY') || '.'
               when 'due' then 'Invoice ' || due.number || ' is due today.'
               else 'Invoice ' || due.number || ' was due on ' || to_char(due.due_date, 'FMDD Mon YYYY')
                    || '. If you have already paid, thank you, and please ignore this.'
             end),
           'reminder:' || due.id || ':' || due.stage
    from due
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*)::int into queued from ins;
  return queued;
end;
$$;
revoke all on function public.queue_due_reminders() from public, anon, authenticated;
grant execute on function public.queue_due_reminders() to service_role;

-- 08:00 SAST every day. The outbox schedule then sends them within a minute.
select cron.schedule('reminders-daily', '0 6 * * *', $cron$select public.queue_due_reminders()$cron$);
