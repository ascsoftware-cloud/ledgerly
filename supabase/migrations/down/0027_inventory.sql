-- Down for 0027_inventory. Restores save_document_draft / convert_quote_to_invoice from 0010 / 0009 by re-running those definitions after this.
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
