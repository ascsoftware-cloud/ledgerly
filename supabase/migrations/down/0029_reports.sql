-- Down for 0029_reports.
drop function if exists public.report_cashflow(uuid, date);
drop function if exists public.report_aged_debtors(uuid, date);
drop function if exists public.report_vat(uuid, date, date);
drop function if exists public.report_pnl(uuid, date, date);
drop function if exists app.report_guard(uuid, date, date);
