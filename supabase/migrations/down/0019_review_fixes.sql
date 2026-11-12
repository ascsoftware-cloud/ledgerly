-- Reverses 0019_review_fixes. After these statements, re-run the earlier definitions of:
--   public.send_document, public.void_document              (0009_sales.sql)
--   public.mark_document_viewed                              (0011_public_documents.sql)
--   public.queue_document_email                              (0012_outbox.sql)
--   public.record_manual_payment, public.connect_payment_provider,
--   public.attach_yoco_webhook (returns void)                (0014_payments.sql)
drop function if exists public.remove_payment(uuid);
drop function if exists public.purge_connection_secrets(uuid);
drop function if exists public.attach_yoco_webhook(uuid, text, text);
drop function if exists app.settle_status(uuid);

delete from public.payment_connections where status = 'pending';
alter table public.payment_connections drop constraint payment_connections_status_check;
alter table public.payment_connections add constraint payment_connections_status_check check (status in ('active', 'disabled'));

delete from public.activities where kind = 'payment_removed';
alter table public.activities drop constraint activities_kind_check;
alter table public.activities add constraint activities_kind_check
  check (kind in ('contact_created', 'note_added', 'quote_sent', 'quote_accepted',
                  'invoice_sent', 'invoice_viewed', 'payment_received', 'deal_moved'));

drop policy sales_documents_insert on public.sales_documents;
create policy sales_documents_insert on public.sales_documents for insert to authenticated
  with check (status = 'draft' and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
