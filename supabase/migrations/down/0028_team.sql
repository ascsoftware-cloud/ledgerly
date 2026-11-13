-- Down for 0028_team.
drop function if exists public.list_members(uuid);
drop function if exists public.queue_invite_email(uuid, text, uuid);
drop function if exists public.accept_invite(text);
drop function if exists public.invite_preview(text);
drop function if exists public.invite_member(uuid, text, text, text);
drop trigger if exists audit_po_received on public.purchase_orders;
drop trigger if exists audit_stock_adjusted on public.stock_movements;
drop trigger if exists audit_payment_removed on public.payments;
drop trigger if exists audit_document on public.sales_documents;
drop trigger if exists audit_invite on public.invites;
drop trigger if exists audit_membership on public.memberships;
drop function if exists app.audit_po_received();
drop function if exists app.audit_stock_adjusted();
drop function if exists app.audit_payment_removed();
drop function if exists app.audit_document();
drop function if exists app.audit_invite();
drop function if exists app.audit_membership();
drop table if exists public.audit_log;
drop function if exists app.audit(uuid, uuid, text, text, text, uuid);
drop function if exists app.rand(bigint);
drop function if exists app.person(uuid);
delete from public.outbox where template = 'team_invite';
alter table public.outbox drop constraint outbox_template_check;
alter table public.outbox add constraint outbox_template_check
  check (template in ('document', 'reminder', 'booking_confirmed', 'booking_reminder'));
