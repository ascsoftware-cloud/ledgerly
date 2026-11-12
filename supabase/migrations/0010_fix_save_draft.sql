-- 0010_fix_save_draft: save_document_draft (SECURITY INVOKER) called app.recalc_document,
-- which signed-in users may not execute. The call was redundant: the line triggers already
-- recalculate totals on every insert and delete. Down: re-run the 0009 definition.

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
