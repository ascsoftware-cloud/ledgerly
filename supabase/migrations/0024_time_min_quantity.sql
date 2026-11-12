-- 0024_time_min_quantity: entries under 18 seconds rounded to 0.00 h, which an invoice line
-- refuses (quantity > 0), so billing them failed. They now bill as 0.01 h.
-- Down: re-run public.invoice_time_entries from 0023_time.sql.

create or replace function public.invoice_time_entries(p_project uuid, p_entries uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.projects%rowtype;
  inv uuid;
  wanted integer := coalesce(array_length(p_entries, 1), 0);
  usable integer;
  vat smallint;
begin
  select * into p from public.projects where id = p_project and deleted_at is null;
  if not found or not app.has_role(p.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;
  if wanted = 0 then
    raise exception 'Choose the hours to bill' using errcode = 'LDG03';
  end if;
  if p.contact_id is null then
    raise exception 'Add a client to the project first, so the invoice knows who to bill' using errcode = 'LDG03';
  end if;
  if p.hourly_rate_cents <= 0 then
    raise exception 'Set an hourly rate on the project first' using errcode = 'LDG03';
  end if;

  perform 1 from public.time_entries where id = any (p_entries) for update;
  select count(*) into usable from public.time_entries
  where id = any (p_entries) and workspace_id = p.workspace_id and project_id = p.id
    and billable and ended_at is not null and invoice_id is null;
  if usable <> wanted then
    raise exception 'Some of these hours are already on an invoice, not billable, or still running' using errcode = 'LDG03';
  end if;

  select case when s.vat_registered then 15 else 0 end into vat from public.workspace_settings s where s.workspace_id = p.workspace_id;
  insert into public.sales_documents (workspace_id, kind, contact_id, notes)
  values (p.workspace_id, 'invoice', p.contact_id, left('Time for ' || p.name, 2000))
  returning id into inv;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity, unit_cents, vat_rate)
  select p.workspace_id, inv, row_number() over (order by e.started_at),
         left(coalesce(e.description, t.title, 'Work') || ' (' || to_char(e.started_at at time zone 'Africa/Johannesburg', 'FMDD Mon YYYY') || ')', 300),
         -- A few seconds still bills as 0.01 h: an invoice line must have a quantity.
         greatest(round(extract(epoch from (e.ended_at - e.started_at)) / 3600.0, 2), 0.01),
         p.hourly_rate_cents, coalesce(vat, 0)
  from public.time_entries e left join public.tasks t on t.id = e.task_id
  where e.id = any (p_entries);
  perform app.recalc_document(inv);
  update public.time_entries set invoice_id = inv where id = any (p_entries);
  return inv;
end;
$$;
