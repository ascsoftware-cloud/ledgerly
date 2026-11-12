-- 0012_outbox: every email (and later SMS/push) goes through one queue, so a retry or
-- a double tap can never send twice. The worker (/api/jobs/outbox) drains it.
-- Down: drop function public.queue_document_email(uuid, text, text, uuid), public.claim_outbox(integer),
--       public.finish_outbox(uuid, boolean, text, text); drop table public.outbox;

create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  template text not null check (template in ('document', 'reminder')),
  to_address text not null check (to_address = lower(to_address) and to_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  reply_to text check (reply_to is null or reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  payload jsonb not null default '{}'::jsonb,
  -- One row per intent: the same key twice is the same email.
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 500),
  provider_id text check (char_length(provider_id) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_due_idx on public.outbox (next_attempt_at) where status = 'pending';
create index outbox_ws_idx on public.outbox (workspace_id, created_at desc);
create index outbox_created_by_idx on public.outbox (created_by);

alter table public.outbox enable row level security;
revoke all on public.outbox from anon, authenticated;
grant select on public.outbox to authenticated;
create policy outbox_select on public.outbox for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

/**
 * Queues a sent document to be emailed. `p_request` is a fresh id per button press,
 * so pressing twice (or a network retry) queues one email. Returns the outbox id.
 */
create or replace function public.queue_document_email(p_doc uuid, p_to text, p_message text, p_request uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents%rowtype;
  to_addr text := lower(btrim(coalesce(p_to, '')));
  sender_email text;
  out_id uuid;
begin
  select * into d from public.sales_documents where id = p_doc;
  if not found or not app.has_role(d.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Document not found' using errcode = 'no_data_found';
  end if;
  if d.status = 'draft' then
    raise exception 'Send the document before emailing it' using errcode = 'LDG03';
  end if;
  if d.status = 'void' then
    raise exception 'This document was voided' using errcode = 'LDG03';
  end if;
  if to_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(to_addr) > 254 then
    raise exception 'That email address does not look right' using errcode = 'LDG03';
  end if;
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception 'Keep the message under 1 000 characters' using errcode = 'LDG03';
  end if;

  select email into sender_email from auth.users where id = (select auth.uid());

  insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key, created_by)
  values (d.workspace_id, 'document', to_addr, lower(sender_email),
          jsonb_build_object('document_id', d.id, 'message', nullif(btrim(coalesce(p_message, '')), '')),
          'document:' || d.id || ':' || p_request, (select auth.uid()))
  on conflict (idempotency_key) do nothing
  returning id into out_id;

  if out_id is null then
    select id into out_id from public.outbox where idempotency_key = 'document:' || d.id || ':' || p_request;
  end if;
  return out_id;
end;
$$;
revoke all on function public.queue_document_email(uuid, text, text, uuid) from public, anon;
grant execute on function public.queue_document_email(uuid, text, text, uuid) to authenticated;

/** Worker only: takes up to `p_limit` due messages, so two workers never take the same one. */
create or replace function public.claim_outbox(p_limit integer)
returns setof public.outbox
language sql
security definer
set search_path = ''
as $$
  update public.outbox o
  set status = 'sending', attempts = o.attempts + 1
  where o.id in (
    select id from public.outbox
    where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  )
  returning o.*;
$$;

/** Worker only: records the result. Failures retry after 2, 4, 8, 16 minutes, then give up. */
create or replace function public.finish_outbox(p_id uuid, p_ok boolean, p_provider_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.outbox
  set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
      sent_at = case when p_ok then now() end,
      provider_id = left(p_provider_id, 200),
      last_error = case when p_ok then null else left(p_error, 500) end,
      next_attempt_at = case when p_ok then next_attempt_at else now() + make_interval(mins => power(2, attempts)::int) end
  where id = p_id and status = 'sending';
$$;

/** Messages stuck in "sending" (a worker died) go back to the queue after 10 minutes. */
create or replace function public.release_stuck_outbox()
returns integer
language sql
security definer
set search_path = ''
as $$
  with r as (
    update public.outbox set status = 'pending'
    where status = 'sending' and next_attempt_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::int from r;
$$;

revoke all on function public.claim_outbox(integer) from public, anon, authenticated;
revoke all on function public.finish_outbox(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.release_stuck_outbox() from public, anon, authenticated;
grant execute on function public.claim_outbox(integer) to service_role;
grant execute on function public.finish_outbox(uuid, boolean, text, text) to service_role;
grant execute on function public.release_stuck_outbox() to service_role;
