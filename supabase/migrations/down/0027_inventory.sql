-- Down for 0027_inventory (the old function bodies are restored at the end).
drop trigger if exists sales_stock on public.sales_documents;
drop function if exists app.sales_stock();
drop function if exists public.receive_purchase_order(uuid, boolean);
drop function if exists public.set_purchase_order_status(uuid, text);
drop function if exists public.adjust_stock(uuid, numeric, text, text);
drop function if exists public.stock_warnings(uuid);
drop table if exists public.purchase_order_lines, public.purchase_orders;
drop function if exists app.guard_po_lines();
drop function if exists app.number_purchase_order();
delete from public.document_sequences where kind = 'purchase_order';
alter table public.document_sequences drop constraint document_sequences_kind_check;
alter table public.document_sequences add constraint document_sequences_kind_check
  check (kind in ('invoice', 'quote', 'credit_note'));
alter table public.sales_document_lines drop constraint sales_document_lines_product_fkey;
alter table public.sales_document_lines drop column product_id;
drop table if exists public.stock_movements, public.products, public.suppliers;
drop function if exists app.apply_stock_movement();

-- Restored: the bodies from before 0027 (no product_id).
create or replace function public.save_document_draft(p_workspace uuid, p_id uuid, p_doc jsonb, p_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  doc_id uuid := p_id;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'Lines must be a list of at most 200' using errcode = 'check_violation';
  end if;

  if doc_id is null then
    insert into public.sales_documents (workspace_id, kind, contact_id, issue_date, due_date, notes, terms,
                                        deposit_type, deposit_value, source_id)
    values (p_workspace, p_doc ->> 'kind', (p_doc ->> 'contact_id')::uuid,
            coalesce((p_doc ->> 'issue_date')::date, (now() at time zone 'Africa/Johannesburg')::date),
            (p_doc ->> 'due_date')::date, p_doc ->> 'notes', p_doc ->> 'terms',
            p_doc ->> 'deposit_type', (p_doc ->> 'deposit_value')::numeric, (p_doc ->> 'source_id')::uuid)
    returning id into doc_id;
  else
    update public.sales_documents
    set contact_id = (p_doc ->> 'contact_id')::uuid,
        issue_date = coalesce((p_doc ->> 'issue_date')::date, issue_date),
        due_date = (p_doc ->> 'due_date')::date,
        notes = p_doc ->> 'notes',
        terms = p_doc ->> 'terms',
        deposit_type = p_doc ->> 'deposit_type',
        deposit_value = (p_doc ->> 'deposit_value')::numeric
    where id = doc_id and workspace_id = p_workspace;
    if not found then
      raise exception 'Draft not found' using errcode = 'no_data_found';
    end if;
    delete from public.sales_document_lines where document_id = doc_id and workspace_id = p_workspace;
  end if;

  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity,
                                           unit_cents, discount_pct, vat_rate)
  select p_workspace, doc_id, l.ord::smallint, l.v ->> 'description', (l.v ->> 'quantity')::numeric,
         (l.v ->> 'unit_cents')::bigint, coalesce((l.v ->> 'discount_pct')::numeric, 0),
         coalesce((l.v ->> 'vat_rate')::smallint, 0)
  from jsonb_array_elements(p_lines) with ordinality as l (v, ord);

  -- Totals are already up to date: every line insert and delete recalculates them.
  return doc_id;
end;
$$;

create or replace function public.convert_quote_to_invoice(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.sales_documents%rowtype;
  inv uuid;
begin
  select * into q from public.sales_documents where id = p_quote and kind = 'quote' for update;
  if not found or not app.has_role(q.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Quote not found' using errcode = 'no_data_found';
  end if;
  if q.status in ('draft', 'declined', 'void') then
    raise exception 'Send the quote before turning it into an invoice' using errcode = 'LDG03';
  end if;
  select id into inv from public.sales_documents
  where workspace_id = q.workspace_id and kind = 'invoice' and source_id = q.id and status <> 'void'
  limit 1;
  if inv is not null then
    return inv;
  end if;

  insert into public.sales_documents (workspace_id, kind, contact_id, notes, terms, deposit_type, deposit_value, source_id)
  values (q.workspace_id, 'invoice', q.contact_id, q.notes, q.terms, q.deposit_type, q.deposit_value, q.id)
  returning id into inv;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity,
                                           unit_cents, discount_pct, vat_rate)
  select workspace_id, inv, position, description, quantity, unit_cents, discount_pct, vat_rate
  from public.sales_document_lines where document_id = q.id;
  perform app.recalc_document(inv);
  return inv;
end;
$$;
