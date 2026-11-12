-- 0020_expenses: expenses with categories and private receipts, plus recurring costs.
-- Down script: supabase/migrations/down/0020_expenses.sql

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index expense_categories_name_uq on public.expense_categories (workspace_id, lower(name));

create table public.recurring_costs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  supplier text not null check (char_length(btrim(supplier)) between 1 and 120),
  description text check (char_length(description) <= 300),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  vat_cents bigint not null default 0 check (vat_cents >= 0),
  category_id uuid,
  cadence text not null check (cadence in ('weekly', 'monthly', 'yearly')),
  next_date date not null,
  -- The day of the month it falls on, so 31 Jan → 28 Feb → 31 Mar instead of drifting to the 28th.
  anchor_day smallint not null check (anchor_day between 1 and 31),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (vat_cents <= amount_cents),
  foreign key (workspace_id, category_id) references public.expense_categories (workspace_id, id) on delete set null (category_id)
);
create index recurring_costs_due_idx on public.recurring_costs (next_date) where active;
create index recurring_costs_ws_idx on public.recurring_costs (workspace_id);
create index recurring_costs_category_idx on public.recurring_costs (workspace_id, category_id);
create index recurring_costs_created_by_idx on public.recurring_costs (created_by);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  spent_on date not null,
  -- Amount paid including VAT; vat_cents is the claimable input VAT inside it.
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  vat_cents bigint not null default 0 check (vat_cents >= 0),
  supplier text check (char_length(supplier) <= 120),
  description text check (char_length(description) <= 300),
  category_id uuid,
  payment_method text check (payment_method in ('card', 'eft', 'cash', 'debit_order', 'other')),
  receipt_path text check (char_length(receipt_path) <= 300),
  recurring_id uuid,
  -- One per button press, recurring run or bank line: the same intent twice is one expense.
  idempotency_key text unique check (char_length(idempotency_key) between 8 and 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  check (vat_cents <= amount_cents),
  check (receipt_path is null or split_part(receipt_path, '/', 1) = workspace_id::text),
  foreign key (workspace_id, category_id) references public.expense_categories (workspace_id, id) on delete set null (category_id),
  foreign key (workspace_id, recurring_id) references public.recurring_costs (workspace_id, id) on delete set null (recurring_id)
);
create index expenses_ws_date_idx on public.expenses (workspace_id, spent_on desc) where deleted_at is null;
create index expenses_category_idx on public.expenses (workspace_id, category_id);
create index expenses_recurring_idx on public.expenses (workspace_id, recurring_id);
create index expenses_created_by_idx on public.expenses (created_by);

create trigger touch_expense_categories before update on public.expense_categories for each row execute function app.touch_updated_at();
create trigger touch_recurring_costs before update on public.recurring_costs for each row execute function app.touch_updated_at();
create trigger touch_expenses before update on public.expenses for each row execute function app.touch_updated_at();
create trigger fixed_ws_expense_categories before update on public.expense_categories for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_recurring_costs before update on public.recurring_costs for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_expenses before update on public.expenses for each row execute function app.forbid_workspace_change();

-- ---------------------------------------------------------------------------
-- Standard categories for every workspace, new and existing.
-- ---------------------------------------------------------------------------
create or replace function app.seed_expense_categories(ws uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.expense_categories (workspace_id, name)
  select ws, n from unnest(array[
    'Stock and materials', 'Fuel and travel', 'Rent', 'Electricity and water', 'Phone and internet',
    'Software and subscriptions', 'Bank fees', 'Marketing', 'Equipment', 'Salaries and wages',
    'Professional fees', 'Insurance', 'Meals and entertainment', 'Other'
  ]) as n
  on conflict do nothing;
$$;

create or replace function app.on_workspace_created_expenses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_expense_categories(new.id);
  return new;
end;
$$;
create trigger seed_expense_categories after insert on public.workspaces
  for each row execute function app.on_workspace_created_expenses();

select app.seed_expense_categories(id) from public.workspaces;

-- Logging an expense: 5 XP once per expense, and the "Log an expense" quest step.
create or replace function app.on_expense_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Automatic recurring entries are not something the user did, so they earn nothing.
  if new.recurring_id is null then
    perform app.award_xp(new.workspace_id, new.created_by, 'expense_logged', new.id::text);
    perform app.complete_quest_step(new.workspace_id, 'first_expense');
  end if;
  return new;
end;
$$;
create trigger expense_logged after insert on public.expenses
  for each row execute function app.on_expense_logged();

revoke all on function app.seed_expense_categories(uuid) from public, anon, authenticated;
revoke all on function app.on_workspace_created_expenses() from public, anon, authenticated;
revoke all on function app.on_expense_logged() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recurring costs: a daily job adds what is due, catching up missed periods.
-- ---------------------------------------------------------------------------
create or replace function app.next_occurrence(d date, cadence text, anchor smallint)
returns date
language sql
immutable
set search_path = ''
as $$
  select case cadence
    when 'weekly' then d + 7
    else (
      with m as (select (date_trunc('month', d::timestamp) + case when cadence = 'yearly' then interval '12 months' else interval '1 month' end)::date as first)
      select m.first + (least(anchor::int, extract(day from (m.first + interval '1 month' - interval '1 day'))::int) - 1)
      from m
    )
  end;
$$;
revoke all on function app.next_occurrence(date, text, smallint) from public, anon, authenticated;

create or replace function public.run_recurring_costs(p_today date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := coalesce(p_today, (now() at time zone 'Africa/Johannesburg')::date);
  rc public.recurring_costs%rowtype;
  added integer := 0;
  n integer;
begin
  for rc in
    select c.* from public.recurring_costs c join public.workspaces w on w.id = c.workspace_id
    where c.active and c.next_date <= today and w.deleted_at is null
    for update of c skip locked
  loop
    while rc.next_date <= today loop
      insert into public.expenses (workspace_id, spent_on, amount_cents, vat_cents, supplier, description,
                                   category_id, payment_method, recurring_id, idempotency_key, created_by)
      values (rc.workspace_id, rc.next_date, rc.amount_cents, rc.vat_cents, rc.supplier, rc.description,
              rc.category_id, 'debit_order', rc.id, 'recurring:' || rc.id || ':' || rc.next_date, rc.created_by)
      on conflict (idempotency_key) do nothing;
      get diagnostics n = row_count;
      added := added + n;
      rc.next_date := app.next_occurrence(rc.next_date, rc.cadence, rc.anchor_day);
    end loop;
    update public.recurring_costs set next_date = rc.next_date where id = rc.id;
  end loop;
  return added;
end;
$$;
revoke all on function public.run_recurring_costs(date) from public, anon, authenticated;
grant execute on function public.run_recurring_costs(date) to service_role;

-- 06:00 SAST every day.
select cron.schedule('recurring-costs-daily', '0 4 * * *', $cron$select public.run_recurring_costs()$cron$);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.expense_categories enable row level security;
alter table public.recurring_costs enable row level security;
alter table public.expenses enable row level security;
revoke all on public.expense_categories, public.recurring_costs, public.expenses from anon, authenticated;

grant select on public.expense_categories, public.recurring_costs, public.expenses to authenticated;
grant insert (workspace_id, name) on public.expense_categories to authenticated;
grant update (name) on public.expense_categories to authenticated;
grant delete on public.expense_categories to authenticated;
grant insert (workspace_id, supplier, description, amount_cents, vat_cents, category_id, cadence, next_date, anchor_day, active)
  on public.recurring_costs to authenticated;
grant update (supplier, description, amount_cents, vat_cents, category_id, cadence, next_date, anchor_day, active)
  on public.recurring_costs to authenticated;
grant delete on public.recurring_costs to authenticated;
grant insert (workspace_id, spent_on, amount_cents, vat_cents, supplier, description, category_id, payment_method, receipt_path, idempotency_key)
  on public.expenses to authenticated;
grant update (spent_on, amount_cents, vat_cents, supplier, description, category_id, payment_method, receipt_path, deleted_at)
  on public.expenses to authenticated;

create policy expense_categories_select on public.expense_categories for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy expense_categories_write on public.expense_categories for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy expense_categories_update on public.expense_categories for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy expense_categories_delete on public.expense_categories for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy recurring_costs_select on public.recurring_costs for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy recurring_costs_insert on public.recurring_costs for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy recurring_costs_update on public.recurring_costs for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy recurring_costs_delete on public.recurring_costs for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy expenses_select on public.expenses for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy expenses_insert on public.expenses for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy expenses_update on public.expenses for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

-- ---------------------------------------------------------------------------
-- Receipts: private bucket, one folder per workspace. The folder name is only
-- cast to uuid when it looks like one, so a malformed path is refused, not an error.
-- ---------------------------------------------------------------------------
create or replace function app.folder_workspace(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(object_name, '/', 1)::uuid end;
$$;
grant execute on function app.folder_workspace(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (select app.is_member(app.folder_workspace(name))));
create policy receipts_write on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (select app.has_role(app.folder_workspace(name), array['owner', 'admin', 'staff'])));
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (select app.has_role(app.folder_workspace(name), array['owner', 'admin', 'staff'])));
