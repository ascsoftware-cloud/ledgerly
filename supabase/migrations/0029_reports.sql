-- 0029_reports: profit and loss, VAT, aged debtors and a 90-day cash-flow forecast.
-- Down script: supabase/migrations/down/0029_reports.sql
--
-- Owners, admins and accountants only; everyone else (staff included) gets "not found".
-- Basis: invoice basis (accrual). Income = invoices sent in the period (ex VAT) less credit notes sent in the period;
-- drafts, void documents and quotes never count. Costs = expenses ex claimable VAT. Dates are SAST dates.

create or replace function app.report_guard(ws uuid, d1 date, d2 date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_role(ws, array['owner', 'admin', 'accountant']) then
    raise exception 'Reports not found' using errcode = 'no_data_found';
  end if;
  if d1 is not null and (d2 is null or d1 > d2 or d2 - d1 > 1830) then
    raise exception 'Choose a date range that ends after it starts, up to five years' using errcode = 'LDG03';
  end if;
end;
$$;
revoke all on function app.report_guard(uuid, date, date) from public, anon, authenticated;

create or replace function public.report_pnl(p_ws uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inc bigint;
  cred bigint;
  cnt integer;
  spent bigint;
  cats jsonb;
begin
  perform app.report_guard(p_ws, p_from, p_to);
  select coalesce(sum(subtotal_cents) filter (where kind = 'invoice'), 0),
         coalesce(sum(subtotal_cents) filter (where kind = 'credit_note'), 0),
         count(*) filter (where kind = 'invoice')
  into inc, cred, cnt
  from public.sales_documents
  where workspace_id = p_ws and kind in ('invoice', 'credit_note') and status not in ('draft', 'void')
    and issue_date between p_from and p_to;

  select coalesce(sum(amount_cents - vat_cents), 0) into spent
  from public.expenses
  where workspace_id = p_ws and deleted_at is null and spent_on between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('category', x.cat, 'cents', x.cents) order by x.cents desc, x.cat), '[]'::jsonb) into cats
  from (
    select coalesce(c.name, 'Uncategorised') as cat, sum(e.amount_cents - e.vat_cents) as cents
    from public.expenses e
    left join public.expense_categories c on c.id = e.category_id and c.workspace_id = e.workspace_id
    where e.workspace_id = p_ws and e.deleted_at is null and e.spent_on between p_from and p_to
    group by 1
  ) x;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'income_cents', inc, 'credit_cents', cred, 'net_income_cents', inc - cred,
    'expenses_cents', spent, 'profit_cents', inc - cred - spent,
    'invoice_count', cnt, 'expenses_by_category', cats);
end;
$$;

create or replace function public.report_vat(p_ws uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  out_vat bigint;
  in_vat bigint;
  std bigint;
  zero bigint;
  registered boolean;
begin
  perform app.report_guard(p_ws, p_from, p_to);
  select coalesce(sum(case when kind = 'invoice' then vat_cents else -vat_cents end), 0) into out_vat
  from public.sales_documents
  where workspace_id = p_ws and kind in ('invoice', 'credit_note') and status not in ('draft', 'void') and issue_date between p_from and p_to;

  select coalesce(sum(case when d.kind = 'invoice' then l.net_cents else -l.net_cents end) filter (where l.vat_rate = 15), 0),
         coalesce(sum(case when d.kind = 'invoice' then l.net_cents else -l.net_cents end) filter (where l.vat_rate = 0), 0)
  into std, zero
  from public.sales_document_lines l
  join public.sales_documents d on d.id = l.document_id and d.workspace_id = l.workspace_id
  where d.workspace_id = p_ws and d.kind in ('invoice', 'credit_note') and d.status not in ('draft', 'void') and d.issue_date between p_from and p_to;

  select coalesce(sum(vat_cents), 0) into in_vat
  from public.expenses where workspace_id = p_ws and deleted_at is null and spent_on between p_from and p_to;

  select coalesce(vat_registered, false) into registered from public.workspace_settings where workspace_id = p_ws;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'vat_registered', coalesce(registered, false),
    'output_vat_cents', out_vat, 'input_vat_cents', in_vat, 'net_vat_cents', out_vat - in_vat,
    'standard_rated_cents', std, 'zero_rated_cents', zero);
end;
$$;

create or replace function public.report_aged_debtors(p_ws uuid, p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  res jsonb;
begin
  perform app.report_guard(p_ws, null, null);
  with o as (
    select c.name as contact, d.number, coalesce(d.due_date, d.issue_date) as due_date,
           greatest(p_as_of - coalesce(d.due_date, d.issue_date), 0) as days,
           d.total_cents - d.paid_cents - d.credited_cents as balance,
           case
             when p_as_of - coalesce(d.due_date, d.issue_date) <= 0 then 'current'
             when p_as_of - coalesce(d.due_date, d.issue_date) <= 30 then 'd1_30'
             when p_as_of - coalesce(d.due_date, d.issue_date) <= 60 then 'd31_60'
             when p_as_of - coalesce(d.due_date, d.issue_date) <= 90 then 'd61_90'
             else 'over_90'
           end as bucket
    from public.sales_documents d
    join public.contacts c on c.id = d.contact_id and c.workspace_id = d.workspace_id
    where d.workspace_id = p_ws and d.kind = 'invoice' and d.status in ('sent', 'viewed', 'part_paid')
      and d.total_cents - d.paid_cents - d.credited_cents > 0
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'totals', (select jsonb_build_object(
        'current', coalesce(sum(balance) filter (where bucket = 'current'), 0),
        'd1_30', coalesce(sum(balance) filter (where bucket = 'd1_30'), 0),
        'd31_60', coalesce(sum(balance) filter (where bucket = 'd31_60'), 0),
        'd61_90', coalesce(sum(balance) filter (where bucket = 'd61_90'), 0),
        'over_90', coalesce(sum(balance) filter (where bucket = 'over_90'), 0),
        'total', coalesce(sum(balance), 0)) from o),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('contact', x.contact, 'number', x.number, 'due_date', x.due_date,
                                                          'days_overdue', x.days, 'balance_cents', x.balance, 'bucket', x.bucket)
                                       order by x.days desc, x.number)
                      from (select * from o order by days desc, number limit 500) x), '[]'::jsonb),
    'by_client', coalesce((select jsonb_agg(jsonb_build_object('contact', y.contact, 'total_cents', y.total) order by y.total desc, y.contact)
                           from (select contact, sum(balance) as total from o group by contact) y), '[]'::jsonb))
  into res;
  return res;
end;
$$;

create or replace function public.report_cashflow(p_ws uuid, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := coalesce(p_today, app.sast_today());
  horizon date := coalesce(p_today, app.sast_today()) + 90;
  ins bigint[] := array_fill(0::bigint, array[13]);
  outs bigint[] := array_fill(0::bigint, array[13]);
  rc record;
  d date;
  wk integer;
  n integer;
  running bigint := 0;
  weeks jsonb := '[]'::jsonb;
  i integer;
begin
  perform app.report_guard(p_ws, null, null);

  -- Money coming in: each open invoice on its due date; anything overdue is counted in the first week.
  for rc in
    select coalesce(due_date, issue_date) as due, total_cents - paid_cents - credited_cents as owed
    from public.sales_documents
    where workspace_id = p_ws and kind = 'invoice' and status in ('sent', 'viewed', 'part_paid')
      and total_cents - paid_cents - credited_cents > 0
  loop
    d := greatest(rc.due, today);
    if d <= horizon then
      wk := (d - today) / 7;
      ins[wk + 1] := ins[wk + 1] + rc.owed;
    end if;
  end loop;

  -- Money going out: each repeating cost on its schedule. Past-due runs happen at the next daily job, so they count now.
  for rc in
    select cadence, next_date, anchor_day, amount_cents from public.recurring_costs where workspace_id = p_ws and active
  loop
    d := rc.next_date;
    n := 0;
    while d <= horizon and n < 200 loop
      wk := (greatest(d, today) - today) / 7;
      outs[wk + 1] := outs[wk + 1] + rc.amount_cents;
      d := app.next_occurrence(d, rc.cadence, rc.anchor_day);
      n := n + 1;
    end loop;
  end loop;

  for i in 1..13 loop
    running := running + ins[i] - outs[i];
    weeks := weeks || jsonb_build_object('start', today + (i - 1) * 7, 'in_cents', ins[i], 'out_cents', outs[i],
                                          'net_cents', ins[i] - outs[i], 'running_cents', running);
  end loop;
  return jsonb_build_object('today', today, 'weeks', weeks,
    'total_in_cents', (select sum(x) from unnest(ins) x), 'total_out_cents', (select sum(x) from unnest(outs) x));
end;
$$;

revoke all on function public.report_pnl(uuid, date, date), public.report_vat(uuid, date, date),
  public.report_aged_debtors(uuid, date), public.report_cashflow(uuid, date) from public, anon;
grant execute on function public.report_pnl(uuid, date, date), public.report_vat(uuid, date, date),
  public.report_aged_debtors(uuid, date), public.report_cashflow(uuid, date) to authenticated;
