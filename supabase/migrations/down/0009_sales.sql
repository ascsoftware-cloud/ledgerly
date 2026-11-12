-- Reverses 0009_sales. Destroys all invoices, quotes and credit notes.
drop function if exists public.void_document(uuid);
drop function if exists public.create_credit_note(uuid);
drop function if exists public.convert_quote_to_invoice(uuid);
drop function if exists public.send_document(uuid);
drop function if exists public.save_document_draft(uuid, uuid, jsonb, jsonb);
drop table if exists public.document_sequences;
drop table if exists public.sales_document_lines;
drop table if exists public.sales_documents;
drop function if exists app.stamp_document();
drop function if exists app.after_document_change();
drop function if exists app.guard_draft_document();
drop function if exists app.after_lines_change();
drop function if exists app.guard_draft_lines();
drop function if exists app.line_totals();
drop function if exists app.recalc_document(uuid);
drop function if exists app.calc_line(numeric, bigint, numeric, smallint);
