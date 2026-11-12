-- Reverses 0054_accounting_sync.
drop function if exists public.queue_accounting_push(uuid);
drop trigger if exists queue_accounting_payment on public.payments;
drop function if exists app.queue_accounting_payment();
drop trigger if exists queue_accounting_document on public.sales_documents;
drop function if exists app.queue_accounting_document();
