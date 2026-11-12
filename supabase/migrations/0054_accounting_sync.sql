-- 0054_accounting_sync: queues one-way pushes to Xero and Sage Accounting (South Africa).
-- Ledgerly stays the source of truth. Pushing never blocks sending: these triggers only add jobs.
-- Down script: supabase/migrations/down/0054_accounting_sync.sql
--
-- What is pushed, from the moment an accounting app is connected (older documents are not):
--  * an invoice or credit note when it is sent,
--  * a void of an invoice or credit note that was pushed,
--  * every payment recorded against an invoice.
-- Quotes are not pushed.

create or replace function app.queue_accounting_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  if new.kind not in ('invoice', 'credit_note') then
    return new;
  end if;
  for c in
    select id, provider from public.integration_connections
    where workspace_id = new.workspace_id and provider in ('xero', 'sage_za') and status = 'active'
  loop
    if old.status = 'draft' and new.status <> 'draft' and new.status <> 'void' then
      perform public.enqueue_integration_job(c.id, 'push_document', new.id, '{}'::jsonb,
                                             c.provider || ':' || c.id || ':doc:' || new.id, 0);
    elsif new.status = 'void' and old.status <> 'void' and old.status <> 'draft' then
      -- A short delay lets a just-queued push land first; the void job checks the link anyway.
      perform public.enqueue_integration_job(c.id, 'void_document', new.id, '{}'::jsonb,
                                             c.provider || ':' || c.id || ':void:' || new.id, 30);
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function app.queue_accounting_document() from public, anon, authenticated;

create trigger queue_accounting_document after update of status on public.sales_documents
  for each row when (old.status is distinct from new.status)
  execute function app.queue_accounting_document();

create or replace function app.queue_accounting_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  for c in
    select id, provider from public.integration_connections
    where workspace_id = new.workspace_id and provider in ('xero', 'sage_za') and status = 'active'
  loop
    -- Delayed a little, so the invoice push queued in the same moment usually goes first.
    perform public.enqueue_integration_job(c.id, 'push_payment', new.id, '{}'::jsonb,
                                           c.provider || ':' || c.id || ':pay:' || new.id, 20);
  end loop;
  return new;
end;
$$;
revoke all on function app.queue_accounting_payment() from public, anon, authenticated;

create trigger queue_accounting_payment after insert on public.payments
  for each row execute function app.queue_accounting_payment();

/**
 * "Send to Xero/Sage now" for one document (owner, admin or accountant), for documents sent
 * before the app was connected, or after fixing a mapping.
 */
create or replace function public.queue_accounting_push(p_document uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.sales_documents%rowtype;
  c record;
  n integer := 0;
begin
  select * into d from public.sales_documents where id = p_document;
  if not found or not app.has_role(d.workspace_id, array['owner', 'admin', 'accountant']) then
    raise exception 'Document not found' using errcode = 'no_data_found';
  end if;
  if d.kind not in ('invoice', 'credit_note') or d.status in ('draft', 'void') then
    raise exception 'Only sent invoices and credit notes can be sent to your accounting app' using errcode = 'LDG03';
  end if;
  for c in
    select id, provider from public.integration_connections
    where workspace_id = d.workspace_id and provider in ('xero', 'sage_za') and status = 'active'
  loop
    perform public.enqueue_integration_job(c.id, 'push_document', d.id, '{}'::jsonb,
                                           c.provider || ':' || c.id || ':doc:' || d.id, 0);
    -- A finished or failed push for this document starts again.
    update public.integration_jobs
    set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, finished_at = null
    where dedupe_key = c.provider || ':' || c.id || ':doc:' || d.id and status in ('done', 'failed', 'cancelled');
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'Connect Xero or Sage first' using errcode = 'LDG03';
  end if;
  return n;
end;
$$;
revoke all on function public.queue_accounting_push(uuid) from public, anon;
grant execute on function public.queue_accounting_push(uuid) to authenticated;
