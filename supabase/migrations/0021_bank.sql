-- 0021_bank: bank statement CSV imports. Lines are deduplicated by fingerprint; money in can be
-- matched to an invoice (recording an EFT payment) and money out turned into an expense.
-- Owners and admins work with statements; accountants read them; staff do not see them.
-- Down script: supabase/migrations/down/0021_bank.sql

create table public.bank_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 200),
  line_count integer not null default 0 check (line_count >= 0),
  added_count integer not null default 0 check (added_count >= 0),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index bank_imports_ws_idx on public.bank_imports (workspace_id, created_at desc);
create index bank_imports_created_by_idx on public.bank_imports (created_by);

create table public.bank_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  import_id uuid not null,
  posted_on date not null,
  -- Signed: money in is positive, money out negative.
  amount_cents bigint not null check (amount_cents <> 0 and abs(amount_cents) <= 100000000000),
  description text not null check (char_length(description) <= 300),
  fingerprint text not null check (char_length(fingerprint) = 64),
  status text not null default 'new' check (status in ('new', 'matched', 'expense', 'ignored')),
  document_id uuid,
  expense_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, fingerprint),
  foreign key (workspace_id, import_id) references public.bank_imports (workspace_id, id) on delete cascade,
  foreign key (workspace_id, document_id) references public.sales_documents (workspace_id, id) on delete set null (document_id),
  foreign key (workspace_id, expense_id) references public.expenses (workspace_id, id) on delete set null (expense_id)
);
create index bank_lines_ws_date_idx on public.bank_lines (workspace_id, posted_on desc);
create index bank_lines_import_idx on public.bank_lines (workspace_id, import_id);
create index bank_lines_document_idx on public.bank_lines (workspace_id, document_id);
create index bank_lines_expense_idx on public.bank_lines (workspace_id, expense_id);

create trigger touch_bank_lines before update on public.bank_lines for each row execute function app.touch_updated_at();
create trigger fixed_ws_bank_lines before update on public.bank_lines for each row execute function app.forbid_workspace_change();

/**
 * Imports parsed lines: [{posted_on, amount_cents, description, key}]. `key` is the line's
 * identity (date|amount|normalised description|occurrence); it is hashed here, and a line whose
 * hash is already in the workspace is skipped. Returns {import_id, added, duplicates}.
 */
create or replace function public.import_bank_lines(p_workspace uuid, p_file_name text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp uuid;
  total integer := jsonb_array_length(coalesce(p_lines, '[]'::jsonb));
  added integer;
begin
  if not app.has_role(p_workspace, array['owner', 'admin']) then
    raise exception 'Only owners and admins can import bank statements' using errcode = 'insufficient_privilege';
  end if;
  if total = 0 or total > 5000 then
    raise exception 'A statement can have 1 to 5 000 lines' using errcode = 'LDG03';
  end if;
  insert into public.bank_imports (workspace_id, file_name, line_count)
  values (p_workspace, left(coalesce(nullif(btrim(p_file_name), ''), 'statement.csv'), 200), total)
  returning id into imp;

  insert into public.bank_lines (workspace_id, import_id, posted_on, amount_cents, description, fingerprint)
  select p_workspace, imp, (l ->> 'posted_on')::date, (l ->> 'amount_cents')::bigint, left(coalesce(l ->> 'description', ''), 300),
         encode(extensions.digest(convert_to(l ->> 'key', 'UTF8'), 'sha256'), 'hex')
  from jsonb_array_elements(p_lines) as l
  where coalesce(l ->> 'key', '') <> '' and (l ->> 'amount_cents')::bigint <> 0
  on conflict (workspace_id, fingerprint) do nothing;
  get diagnostics added = row_count;

  update public.bank_imports set added_count = added where id = imp;
  return jsonb_build_object('import_id', imp, 'added', added, 'duplicates', total - added);
end;
$$;

/** Money in → a payment on an open invoice of the same workspace. Each line pays once. */
create or replace function public.match_bank_line(p_line uuid, p_doc uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.bank_lines%rowtype;
  res jsonb;
begin
  select * into l from public.bank_lines where id = p_line for update;
  if not found or not app.has_role(l.workspace_id, array['owner', 'admin']) then
    raise exception 'Bank line not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.sales_documents where id = p_doc and workspace_id = l.workspace_id and kind = 'invoice') then
    raise exception 'Invoice not found' using errcode = 'no_data_found';
  end if;
  if l.status <> 'new' then
    raise exception 'This bank line has already been dealt with' using errcode = 'LDG03';
  end if;
  if l.amount_cents <= 0 then
    raise exception 'Only money in can pay an invoice' using errcode = 'LDG03';
  end if;
  -- The line id is the payment's request id, so the same line can never pay twice.
  res := public.record_manual_payment(p_doc, l.amount_cents, 'eft', l.posted_on, left(l.description, 120), null, l.id);
  update public.bank_lines set status = 'matched', document_id = p_doc where id = l.id;
  return res;
end;
$$;

/** Money out → an expense. Each line becomes one expense. Returns the expense id. */
create or replace function public.bank_line_to_expense(p_line uuid, p_category uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.bank_lines%rowtype;
  e uuid;
begin
  select * into l from public.bank_lines where id = p_line for update;
  if not found or not app.has_role(l.workspace_id, array['owner', 'admin']) then
    raise exception 'Bank line not found' using errcode = 'no_data_found';
  end if;
  if l.status <> 'new' then
    raise exception 'This bank line has already been dealt with' using errcode = 'LDG03';
  end if;
  if l.amount_cents >= 0 then
    raise exception 'Only money out can be an expense' using errcode = 'LDG03';
  end if;
  insert into public.expenses (workspace_id, spent_on, amount_cents, supplier, category_id, payment_method, idempotency_key, created_by)
  values (l.workspace_id, l.posted_on, -l.amount_cents, nullif(left(l.description, 120), ''), p_category, 'eft', 'bank:' || l.id, (select auth.uid()))
  returning id into e;
  update public.bank_lines set status = 'expense', expense_id = e where id = l.id;
  return e;
end;
$$;

create or replace function public.set_bank_line_ignored(p_line uuid, p_ignored boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.bank_lines%rowtype;
begin
  select * into l from public.bank_lines where id = p_line for update;
  if not found or not app.has_role(l.workspace_id, array['owner', 'admin']) then
    raise exception 'Bank line not found' using errcode = 'no_data_found';
  end if;
  if l.status not in ('new', 'ignored') then
    raise exception 'This bank line has already been dealt with' using errcode = 'LDG03';
  end if;
  update public.bank_lines set status = case when p_ignored then 'ignored' else 'new' end where id = l.id;
end;
$$;

revoke all on function public.import_bank_lines(uuid, text, jsonb) from public, anon;
revoke all on function public.match_bank_line(uuid, uuid) from public, anon;
revoke all on function public.bank_line_to_expense(uuid, uuid) from public, anon;
revoke all on function public.set_bank_line_ignored(uuid, boolean) from public, anon;
grant execute on function public.import_bank_lines(uuid, text, jsonb) to authenticated;
grant execute on function public.match_bank_line(uuid, uuid) to authenticated;
grant execute on function public.bank_line_to_expense(uuid, uuid) to authenticated;
grant execute on function public.set_bank_line_ignored(uuid, boolean) to authenticated;

alter table public.bank_imports enable row level security;
alter table public.bank_lines enable row level security;
revoke all on public.bank_imports, public.bank_lines from anon, authenticated;
grant select, delete on public.bank_imports to authenticated;
grant select on public.bank_lines to authenticated;

create policy bank_imports_select on public.bank_imports for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'accountant'])));
create policy bank_imports_delete on public.bank_imports for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy bank_lines_select on public.bank_lines for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'accountant'])));
